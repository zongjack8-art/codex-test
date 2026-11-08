import assert from 'node:assert/strict'
import test from 'node:test'
import { oldApp, newApp, school, withMarket, seedProducts } from './market-test-support.mjs'

test('买家可同时下单，只有卖家能确认且只有一单获胜，订单快照独立于商品', async () => {
  await withMarket(async ({ db, as, ok, call, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 1)
    await rejected('createOrder', { productId: 'item-1' }, 'INVALID_INPUT')
    await rejected('createOrder', { productId: 'missing' }, 'NOT_FOUND')
    as(newApp, 'buyer-a')
    const first = ok('createOrder', { productId: 'item-1', amount: 500, sellerId: 'forged' })
    as(newApp, 'buyer-b')
    const second = ok('createOrder', { productId: 'item-1' })
    const [a, b] = await Promise.all([first, second])
    assert.equal(a.amount, 1)
    assert.equal(a.sellerId, seller.id)
    assert.equal(a.status, 'pending')
    assert.equal(a.role, 'buyer')
    assert.equal(a.unread, false)
    await rejected('createOrder', { productId: 'item-1' }, 'INVALID_STATE')
    await rejected('confirmOrder', { id: b.id }, 'FORBIDDEN')
    await rejected('completeOrder', { id: a.id }, 'FORBIDDEN')
    await rejected('cancelOrder', { id: a.id, buyerId: a.buyerId }, 'FORBIDDEN')

    as(oldApp, 'buyer-a')
    await ok('login')
    await rejected('getOrder', { id: a.id }, 'FORBIDDEN')
    assert.deepEqual(await ok('listOrders', { role: 'buyer' }), [])
    as(newApp, 'seller')
    assert.deepEqual(await ok('getOrderUnreadSummary'), { buyer: 0, seller: 2, total: 2 })
    const result = await Promise.all([call('confirmOrder', { id: a.id }), call('confirmOrder', { id: b.id })])
    assert.equal(result.filter(entry => entry.ok).length, 1)
    const winner = result.find(entry => entry.ok).data
    const loser = winner.id === a.id ? b : a
    assert.equal(result.find(entry => !entry.ok).error.code, 'INVALID_STATE')
    assert.equal((await ok('getProduct', { id: 'item-1' })).status, 'reserved')
    assert.equal((await ok('getOrder', { id: loser.id })).cancelReason, 'seller_selected_other_buyer')
    const done = await ok('completeOrder', { id: winner.id })
    assert.equal(done.status, 'completed')
    assert.equal(typeof done.completedAt, 'number')
    assert.equal((await ok('getProduct', { id: 'item-1' })).status, 'sold')
    await rejected('completeOrder', { id: winner.id }, 'INVALID_STATE')
    await db.exec(`UPDATE public.rehub_products SET title='后来改名', price=17 WHERE id='item-1'`)
    await ok('deleteProduct', { id: 'item-1' })
    const history = await ok('getOrder', { id: winner.id })
    assert.equal(history.productTitle, winner.productTitle)
    assert.equal(history.productImage, winner.productImage)
    assert.equal(history.amount, winner.amount)
    assert.equal((await ok('listOrders', { role: 'seller' })).length, 2)
  })
})

test('订单通知和批量已读严格按当前用户与买卖角色处理', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 1)
    as(newApp, 'buyer')
    const buying = await ok('createOrder', { productId: 'item-1' })
    const buyer = await ok('login')
    await db.query(`INSERT INTO public.rehub_product_refs(id,seller_id) VALUES ('reciprocal',$1)`, [buyer.id])
    await db.query(`INSERT INTO public.rehub_products(id,seller_id,title,description,price,category,condition,images,school,status,created_at,updated_at)
      VALUES ('reciprocal',$1,'互购图书','描述',5,'books','九成新',ARRAY['fixture'],$2,'selling',1,1)`, [buyer.id, school])
    as(newApp, 'seller')
    await ok('createOrder', { productId: 'reciprocal' })
    await ok('confirmOrder', { id: buying.id })
    as(newApp, 'buyer')
    assert.deepEqual(await ok('getOrderUnreadSummary'), { buyer: 1, seller: 1, total: 2 })
    await rejected('markOrdersRead', { role: 'other' }, 'INVALID_INPUT')
    await rejected('listOrders', { role: 'other' }, 'INVALID_INPUT')
    assert.deepEqual(await ok('markOrdersRead', { role: 'buyer' }), { cleared: 1 })
    assert.deepEqual(await ok('markOrdersRead', { role: 'buyer' }), { cleared: 0 })
    assert.deepEqual(await ok('getOrderUnreadSummary'), { buyer: 0, seller: 1, total: 1 })
    assert.equal((await ok('listOrders', { role: 'seller' }))[0].unread, true)
    const cancelled = await ok('cancelOrder', { id: buying.id })
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.unread, false)
    assert.equal((await ok('getProduct', { id: 'item-1' })).status, 'selling')
    as(newApp, 'seller')
    assert.deepEqual(await ok('getOrderUnreadSummary'), { buyer: 0, seller: 1, total: 1 })
    assert.deepEqual(await ok('markOrdersRead', { role: 'seller' }), { cleared: 1 })
  })
})

test('旧无预留时间订单保留原流转，管理员下架后取消不会重新上架', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 5)
    as(newApp, 'buyer')
    const buyer = await ok('login')
    const modern = await ok('createOrder', { productId: 'item-4' })
    const takenDown = await ok('createOrder', { productId: 'item-5' })
    await db.query(`INSERT INTO public.rehub_orders(id,product_id,buyer_id,seller_id,product_title,product_image,
      amount,active_key,status,created_at,updated_at)
      SELECT 'legacy-' || n, 'item-' || n, $1, $2, '旧订单快照', 'fixture', n, 'legacy-active-' || n, 'confirmed', 1, 1
      FROM generate_series(1,3) n`, [buyer.id, seller.id])
    as(newApp, 'seller')
    await ok('completeOrder', { id: 'legacy-1' })
    assert.equal((await ok('getProduct', { id: 'item-1' })).status, 'sold')
    await ok('setProductStatus', { id: 'item-2', status: 'sold' })
    await rejected('completeOrder', { id: 'legacy-2' }, 'INVALID_STATE')
    await ok('deleteProduct', { id: 'item-3' })
    assert.equal((await ok('getOrder', { id: 'legacy-3' })).productTitle, '旧订单快照')
    await rejected('completeOrder', { id: 'legacy-3' }, 'INVALID_STATE')
    await ok('cancelOrder', { id: 'legacy-3' })
    await ok('confirmOrder', { id: modern.id })
    await db.exec(`UPDATE public.rehub_products SET status='offline', moderation_status='blocked' WHERE id='item-4'`)
    await ok('cancelOrder', { id: modern.id })
    assert.equal((await ok('getProduct', { id: 'item-4' })).status, 'offline')
    await ok('confirmOrder', { id: takenDown.id })
    await rejected('deleteProduct', { id: 'item-5' }, 'INVALID_STATE')
    await db.exec(`UPDATE public.rehub_products SET status='offline', moderation_status='blocked' WHERE id='item-5'`)
    await ok('deleteProduct', { id: 'item-5' })
    assert.equal((await ok('getOrder', { id: takenDown.id })).status, 'confirmed')
    await ok('cancelOrder', { id: takenDown.id })
    assert.equal(await ok('getProduct', { id: 'item-5' }), null)
  })
})

test('商品会话复用，双方发送与已读按角色隔离，删除后继续显示快照', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 1)
    await rejected('startConversation', { productId: 'item-1' }, 'INVALID_INPUT')
    as(newApp, 'buyer')
    const buyer = await ok('login')
    const chat = await ok('startConversation', { productId: 'item-1', sellerId: 'forged' })
    assert.deepEqual(await ok('startConversation', { productId: 'item-1' }), chat)
    assert.equal(chat.other.id, seller.id)
    assert.equal(chat.unreadCount, 0)
    const fromBuyer = ok('sendMessage', { id: chat.id, content: ' 买家消息 ', senderId: seller.id })
    as(newApp, 'seller')
    const fromSeller = ok('sendMessage', { id: chat.id, content: '卖家消息', receiverId: seller.id })
    const [a, b] = await Promise.all([fromBuyer, fromSeller])
    assert.equal(a.senderId, buyer.id)
    assert.equal(a.content, '买家消息')
    assert.equal(b.receiverId, buyer.id)
    const messages = await ok('listMessages', { id: chat.id })
    assert.equal(messages.length, 2)
    assert.ok(messages[0].createdAt < messages[1].createdAt)
    assert.equal((await ok('getConversation', { id: chat.id })).lastMessage, messages[1].content)
    assert.deepEqual(await ok('getUnreadMessageCount'), { count: 1 })
    assert.deepEqual(await ok('markConversationRead', { id: chat.id }), { unreadCount: 0 })
    assert.deepEqual(await ok('getUnreadMessageCount'), { count: 0 })
    await ok('deleteProduct', { id: 'item-1' })
    as(newApp, 'buyer')
    assert.deepEqual(await ok('getUnreadMessageCount'), { count: 1 })
    const [archived] = await ok('listConversations')
    assert.deepEqual(archived.product, { ...chat.product, status: 'deleted' })
    assert.deepEqual(await ok('listMessages', { id: chat.id }), messages)
    await rejected('startConversation', { productId: 'item-1' }, 'NOT_FOUND')

    as(oldApp, 'buyer')
    await ok('login')
    for (const action of ['getConversation', 'listMessages', 'sendMessage', 'markConversationRead']) {
      await rejected(action, { id: chat.id, userId: buyer.id, content: '越权消息' }, 'FORBIDDEN')
    }
    assert.deepEqual(await ok('listConversations'), [])
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.rehub_messages`)).rows[0].n, 2)
  })
})

test('消息默认最新 100 条，游标跨同一毫秒稳定翻页且不能引用其他会话', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 2)
    as(newApp, 'buyer')
    const buyer = await ok('login')
    const chat = await ok('startConversation', { productId: 'item-1' })
    const other = await ok('startConversation', { productId: 'item-2' })
    const foreign = await ok('sendMessage', { id: other.id, content: '另一会话' })
    await db.query(`INSERT INTO public.rehub_messages(id,conversation_id,sender_id,receiver_id,type,content,created_at)
      SELECT 'legacy-' || lpad(n::text,3,'0'), $1, $2, $3, 'text', '旧消息', n/2 FROM generate_series(1,205) n`,
    [chat.id, buyer.id, seller.id])
    const latest = await ok('listMessages', { id: chat.id })
    const older = await ok('listMessages', { id: chat.id, before: latest[0].id })
    const oldest = await ok('listMessages', { id: chat.id, before: older[0].id })
    assert.deepEqual([latest.length, older.length, oldest.length], [100, 100, 5])
    assert.deepEqual([...oldest, ...older, ...latest].map(row => row.id),
      Array.from({ length: 205 }, (_, i) => `legacy-${String(i + 1).padStart(3, '0')}`))
    assert.deepEqual(await ok('listMessages', { id: chat.id, before: oldest[0].id }), [])
    await rejected('listMessages', { id: chat.id, before: foreign.id }, 'INVALID_INPUT')
  })
})

test('每方各自限频，计数溢出时消息与会话摘要一起回滚', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 1)
    as(newApp, 'buyer')
    const chat = await ok('startConversation', { productId: 'item-1' })
    for (let n = 0; n < 20; n++) await ok('sendMessage', { id: chat.id, content: `消息 ${n}` })
    await rejected('sendMessage', { id: chat.id, content: '超额' }, 'RATE_LIMITED')
    as(newApp, 'seller')
    const sent = await ok('sendMessage', { id: chat.id, content: '卖家仍可发送' })
    await db.query(`UPDATE public.rehub_conversations SET buyer_unread_count = 2147483647 WHERE id=$1`, [chat.id])
    await rejected('sendMessage', { id: chat.id, content: '模拟计数溢出' }, 'SERVER_ERROR')
    assert.equal((await ok('listMessages', { id: chat.id })).length, 21)
    assert.equal((await ok('getConversation', { id: chat.id })).lastMessage, sent.content)
  })
})

test('客户端角色即使获得 EXECUTE，也不能借交易和聊天 RPC 代入身份', async () => {
  await withMarket(async ({ db }) => {
    const calls = [
      ['rehub_create_order(text,text)', "'forged','item-1'"],
      ['rehub_transition_order(text,text,text)', "'forged','order','confirm'"],
      ['rehub_market_order_unread(text)', "'forged'"],
      ['rehub_market_mark_orders_read(text,text)', "'forged','seller'"],
      ['rehub_market_start_chat(text,text,text)', "'forged','item-1','学校'"],
      ['rehub_market_chat_unread(text)', "'forged'"],
      ['rehub_market_chat_messages(text,text,text)', "'forged','chat',NULL"],
      ['rehub_send_message(text,text,text)', "'forged','chat','消息'"],
      ['rehub_mark_conversation_read(text,text)', "'forged','chat'"]
    ]
    await db.exec(`GRANT EXECUTE ON FUNCTION ${calls.map(([signature]) => `public.${signature}`).join(', ')} TO anon, authenticated`)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      try {
        for (const [signature, args] of calls) {
          await assert.rejects(db.query(`SELECT public.${signature.split('(')[0]}(${args})`), { code: '42501' })
        }
      } finally { await db.exec('RESET ROLE') }
    }
  })
})
