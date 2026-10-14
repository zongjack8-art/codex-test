const { createHash } = require('node:crypto')
const { cleanText, fail, safeId, productStatus } = require('./security')
const campus = require('./campus.json')

const conversationId = (buyerId, productId) => `conv_${createHash('sha256').update(`${buyerId}:${productId}`).digest('hex')}`

function createChatHandler({ db, users, products, conversations, messages, ensureUser }) {
  const _ = db.command
  async function one(collection, id) {
    return (await collection.where({ _id: safeId(id) }).limit(1).get()).data[0] || null
  }
  async function accessible(id, openid) {
    const conversation = await one(conversations, id)
    if (!conversation) fail('NOT_FOUND', '会话不存在')
    if (conversation.buyerId !== openid && conversation.sellerId !== openid) fail('FORBIDDEN', '无权查看此会话')
    return conversation
  }
  async function hydrate(items, openid) {
    if (!items.length) return []
    const otherIds = [...new Set(items.map(item => item.buyerId === openid ? item.sellerId : item.buyerId))]
    const productIds = [...new Set(items.map(item => item.productId))]
    const [peopleResult, productResult] = await Promise.all([
      users.where({ _id: _.in(otherIds) }).limit(100).get(),
      products.where({ _id: _.in(productIds) }).limit(100).get()
    ])
    const people = new Map(peopleResult.data.map(person => [person._id, person]))
    const liveProducts = new Map(productResult.data.map(product => [product._id, product]))
    return items.map(item => {
      const otherId = item.buyerId === openid ? item.sellerId : item.buyerId
      const person = people.get(otherId)
      const product = liveProducts.get(item.productId)
      return {
        id: item._id, productId: item.productId, buyerId: item.buyerId, sellerId: item.sellerId,
        other: { id: otherId, nickname: person?.nickname || '校园同学', avatar: person?.avatar || '同' },
        product: product ? { title: product.title, price: product.price, image: product.images?.[0] || '', status: productStatus(product.status) } : { ...item.productSnapshot, status: 'deleted' },
        lastMessage: item.lastMessage || '', lastMessageAt: item.lastMessageAt || item.createdAt,
        unreadCount: item.buyerId === openid ? item.buyerUnreadCount || 0 : item.sellerUnreadCount || 0,
        createdAt: item.createdAt
      }
    })
  }
  async function myConversations(openid) {
    const [buying, selling] = await Promise.all([
      conversations.where({ buyerId: openid }).orderBy('lastMessageAt', 'desc').limit(50).get(),
      conversations.where({ sellerId: openid }).orderBy('lastMessageAt', 'desc').limit(50).get()
    ])
    return [...buying.data, ...selling.data].sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt))
  }
  async function unreadTotal(openid) {
    let total = 0
    for (const [field, unreadField] of [['buyerId', 'buyerUnreadCount'], ['sellerId', 'sellerUnreadCount']]) {
      let offset = 0
      while (offset < 1000) {
        const rows = await conversations.where({ [field]: openid }).skip(offset).limit(100).get()
        total += rows.data.reduce((sum, item) => sum + (item[unreadField] || 0), 0)
        if (rows.data.length < 100) break
        offset += 100
      }
    }
    return total
  }

  return async function chat(action, event, openid) {
    if (action === 'startConversation') {
      const productId = safeId(event.productId)
      const product = await one(products, productId)
      if (!product || (product.school && product.school !== campus.schoolName) || productStatus(product.status) !== 'selling') fail('NOT_FOUND', '这件商品当前无法联系卖家')
      if (product.sellerId === openid) fail('INVALID_INPUT', '不能给自己发送消息')
      await ensureUser(openid)
      const id = conversationId(openid, productId)
      let existing = await one(conversations, id)
      if (!existing) {
        const now = Date.now()
        try {
          await conversations.add({ data: {
            _id: id, productId, buyerId: openid, sellerId: product.sellerId,
            participantIds: [openid, product.sellerId],
            productSnapshot: { title: product.title, price: product.price, image: product.images?.[0] || '', status: productStatus(product.status) },
            lastMessage: '', lastMessageAt: now, buyerUnreadCount: 0, sellerUnreadCount: 0,
            status: 'active', createdAt: now, updatedAt: now
          } })
        } catch (error) {
          existing = await one(conversations, id)
          if (!existing) throw error
        }
      }
      return (await hydrate([existing || await one(conversations, id)], openid))[0]
    }
    if (action === 'listConversations') return hydrate((await myConversations(openid)).slice(0, 100), openid)
    if (action === 'getUnreadMessageCount') return { count: await unreadTotal(openid) }
    if (action === 'getConversation') {
      const item = await accessible(event.id, openid)
      return (await hydrate([item], openid))[0]
    }
    if (action === 'listMessages') {
      const item = await accessible(event.id, openid)
      const rows = await messages.where({ conversationId: item._id }).orderBy('createdAt', 'desc').limit(100).get()
      return rows.data.reverse().map(row => ({ id: row._id, conversationId: row.conversationId, senderId: row.senderId, receiverId: row.receiverId, type: 'text', content: row.content, createdAt: row.createdAt }))
    }
    if (action === 'sendMessage') {
      const item = await accessible(event.id, openid)
      const content = cleanText(event.content, '消息', 1, 500)
      const recent = await messages.where({ conversationId: item._id, senderId: openid, createdAt: _.gte(Date.now() - 60000) }).count()
      if (recent.total >= 20) fail('RATE_LIMITED', '发送太频繁，请稍后再试')
      const receiverId = item.buyerId === openid ? item.sellerId : item.buyerId
      const now = Date.now()
      const added = await messages.add({ data: { conversationId: item._id, senderId: openid, receiverId, type: 'text', content, createdAt: now } })
      const unreadField = item.buyerId === openid ? 'sellerUnreadCount' : 'buyerUnreadCount'
      await conversations.doc(item._id).update({ data: { lastMessage: content.slice(0, 80), lastMessageAt: now, updatedAt: now, [unreadField]: _.inc(1) } })
      return { id: added._id, conversationId: item._id, senderId: openid, receiverId, type: 'text', content, createdAt: now }
    }
    if (action === 'markConversationRead') {
      const item = await accessible(event.id, openid)
      const unreadField = item.buyerId === openid ? 'buyerUnreadCount' : 'sellerUnreadCount'
      await conversations.doc(item._id).update({ data: { [unreadField]: 0 } })
      return { unreadCount: 0 }
    }
    fail('INVALID_ACTION', '不支持的聊天操作')
  }
}

module.exports = { createChatHandler, conversationId }
