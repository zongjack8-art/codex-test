const campus = require('./campus.json')
const { cleanText, fail, safeId } = require('./security')

const chatActions = ['startConversation', 'listConversations', 'getConversation', 'listMessages', 'sendMessage',
  'markConversationRead', 'getUnreadMessageCount']

function otherId(chat, actorId) {
  return chat.buyer_id === actorId ? chat.seller_id : chat.buyer_id
}

async function present(store, chats, actorId) {
  if (!chats.length) return []
  const [people, products] = await Promise.all([
    store.people(chats.map(chat => otherId(chat, actorId))), store.productCards(chats.map(chat => chat.product_id))
  ])
  const listings = new Map(products.map(item => [item.id, item]))
  return chats.map(chat => {
    const other = otherId(chat, actorId)
    const person = people.get(other)
    const item = listings.get(chat.product_id)
    return {
      id: chat.id, productId: chat.product_id, buyerId: chat.buyer_id, sellerId: chat.seller_id,
      other: { id: other, nickname: person?.nickname || '校园同学', avatar: person?.avatar || '同' },
      product: item ? { title: item.title, price: Number(item.price), image: item.images?.[0] || '', status: item.status }
        : { ...chat.product_snapshot, status: 'deleted' },
      lastMessage: chat.last_message || '', lastMessageAt: Number(chat.last_message_at) || Number(chat.created_at),
      unreadCount: Number(chat.buyer_id === actorId ? chat.buyer_unread_count : chat.seller_unread_count),
      createdAt: Number(chat.created_at)
    }
  })
}

function message(row) {
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, receiverId: row.receiver_id,
    type: 'text', content: row.content, createdAt: Number(row.created_at) }
}

async function accessible(store, id, actorId) {
  const chat = await store.chat(id)
  if (!chat) fail('NOT_FOUND', '会话不存在')
  if (chat.buyer_id !== actorId && chat.seller_id !== actorId) fail('FORBIDDEN', '无权查看此会话')
  return chat
}

async function pgChat(store, event, caller, actorId) {
  switch (event.action) {
    case 'startConversation': {
      const productId = safeId(event.productId)
      const item = await store.product(productId)
      if (!item || item.school !== campus.schoolName || item.status !== 'selling') fail('NOT_FOUND', '这件商品当前无法联系卖家')
      if (item.seller_id === actorId) fail('INVALID_INPUT', '不能给自己发送消息')
      const actor = await store.login(caller)
      const id = await store.rpc('start_chat', { p_actor_id: actor.id, p_product_id: productId, p_school: campus.schoolName })
      return (await present(store, [await accessible(store, id, actor.id)], actor.id))[0]
    }
    case 'listConversations': {
      if (!actorId) return []
      const [buying, selling] = await Promise.all([store.chats(actorId, 'buyer'), store.chats(actorId, 'seller')])
      return present(store, [...buying, ...selling].sort((a, b) =>
        (Number(b.last_message_at) || Number(b.created_at)) - (Number(a.last_message_at) || Number(a.created_at))), actorId)
    }
    case 'getUnreadMessageCount': return { count: actorId ? Number(await store.rpc('chat_unread', { p_actor_id: actorId })) : 0 }
    case 'getConversation': return (await present(store, [await accessible(store, safeId(event.id), actorId)], actorId))[0]
    case 'listMessages': {
      const id = safeId(event.id)
      const before = event.before == null ? null : safeId(event.before)
      const rows = await store.rpc('chat_messages', { p_actor_id: actorId ?? null, p_conversation_id: id, p_before: before })
      return rows.map(message)
    }
    case 'sendMessage': {
      const id = safeId(event.id)
      await accessible(store, id, actorId)
      const content = cleanText(event.content, '消息', 1, 500)
      const messageId = await store.transaction('send_message', { p_actor_id: actorId, p_conversation_id: id, p_content: content })
      return message(await store.message(messageId, id))
    }
    case 'markConversationRead': {
      await store.transaction('mark_conversation_read', { p_actor_id: actorId ?? null, p_conversation_id: safeId(event.id) })
      return { unreadCount: 0 }
    }
  }
}

module.exports = { chatActions, pgChat }
