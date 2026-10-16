const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const campus = require('./campus.json')

function fixture() {
  let openid = 'buyer'
  const rows = {
    users: [
      { _id: 'buyer', nickname: '小买', avatar: '买' },
      { _id: 'buyerB', nickname: '小乙', avatar: '乙' },
      { _id: 'buyerC', nickname: '小丙', avatar: '丙' },
      { _id: 'seller', nickname: '小卖', avatar: '卖' },
      { _id: 'outsider', nickname: '路人', avatar: '路' }
    ],
    products: [
      { _id: 'p1', sellerId: 'seller', school: campus.schoolName, title: '闲置教材', images: ['cloud://test/example.jpg'], price: 29, status: 'selling' },
      { _id: 'p2', sellerId: 'seller', school: campus.schoolName, title: '已售教材', images: [], price: 18, status: 'sold' },
      { _id: 'p3', sellerId: 'seller', school: campus.schoolName, title: '下架教材', images: [], price: 18, status: 'offline' },
      { _id: 'legacy', sellerId: 'seller', title: '旧商品', images: [], price: 8 }
    ], favorites: [], reports: [], conversations: [{ _id: 'conv1', productId: 'p1', buyerId: 'buyer', sellerId: 'seller' }],
    messages: [{ _id: 'msg1', conversationId: 'conv1', content: '你好' }], orders: [], admins: []
  }
  const command = { in: values => ({ op: 'in', values }), gte: value => ({ op: 'gte', value }), neq: value => ({ op: 'neq', value }) }
  const matches = (row, query) => Object.entries(query).every(([key, expected]) => {
    if (expected?.op === 'in') return expected.values.includes(row[key])
    if (expected?.op === 'gte') return row[key] >= expected.value
    if (expected?.op === 'neq') return row[key] !== expected.value
    return row[key] === expected
  })
  let previousTransaction = Promise.resolve()
  const db = { command, collection(name) {
    if (!rows[name]) throw new Error(`Unknown collection ${name}`)
    return {
      where(query) {
        let limit = Infinity; let offset = 0; let sort = null
        const cursor = {
          limit(value) { limit = value; return cursor },
          skip(value) { offset = value; return cursor },
          orderBy(field, direction) { sort = [field, direction]; return cursor },
          async get() {
            const found = rows[name].filter(row => matches(row, query))
            if (sort) found.sort((a, b) => directionValue(a[sort[0]], b[sort[0]], sort[1]))
            return { data: found.slice(offset, offset + limit) }
          },
          async count() { return { total: rows[name].filter(row => matches(row, query)).length } }
        }
        return cursor
      },
      doc(id) { return {
        async get() { return { data: rows[name].find(row => row._id === id) || null } },
        async update({ data }) { const row = rows[name].find(item => item._id === id); if (!row) throw new Error('missing doc'); Object.assign(row, data) }
      } },
      async add({ data }) {
        if (rows[name].some(row => row._id === data._id || name === 'orders' && row.activeKey === data.activeKey)) throw new Error('duplicate key')
        rows[name].push({ ...data }); return { _id: data._id }
      }
    }
  }, async runTransaction(callback) {
    const previous = previousTransaction
    let release
    previousTransaction = new Promise(resolve => { release = resolve })
    await previous
    const snapshot = structuredClone(rows)
    try { return await callback({ collection: name => db.collection(name) }) }
    catch (error) { for (const name of Object.keys(rows)) rows[name] = snapshot[name]; throw error }
    finally { release() }
  } }
  const directionValue = (a, b, direction) => direction === 'desc' ? (b || 0) - (a || 0) : (a || 0) - (b || 0)
  const cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return db }, getWXContext() { return { OPENID: openid } } }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  let main
  try { delete require.cache[require.resolve('./index')]; ({ main } = require('./index')) }
  finally { Module._load = originalLoad }
  return { main, rows, setUser: value => { openid = value } }
}

test('买家创建订单时价格和身份来自云端；活跃订单不能重复，取消后可重新发起', async () => {
  const fx = fixture()
  const created = await fx.main({ action: 'createOrder', productId: 'p1', buyerId: 'outsider', sellerId: 'outsider', amount: 0.01, status: 'completed' })
  assert.equal(created.ok, true)
  assert.equal(created.data.status, 'pending')
  assert.equal(created.data.amount, 29)
  assert.equal(created.data.buyerId, 'buyer')
  assert.equal(created.data.sellerId, 'seller')
  assert.equal(fx.rows.orders[0].amount, 29)
  assert.equal((await fx.main({ action: 'createOrder', productId: 'p1' })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'cancelOrder', id: created.data.id })).ok, true)
  assert.equal((await fx.main({ action: 'createOrder', productId: 'p1' })).ok, true)
  assert.equal(fx.rows.orders.length, 2)
})

test('商品详情的卖家标记由真实 OPENID 和数据库卖家决定', async () => {
  const fx = fixture()
  assert.equal((await fx.main({ action: 'getProduct', id: 'p1', buyerId: 'seller' })).data.viewerIsSeller, false)
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'getProduct', id: 'p1', buyerId: 'buyer' })).data.viewerIsSeller, true)
})

test('自己、已售或下架商品不能下单；旧商品缺少状态仍可下单', async () => {
  const fx = fixture()
  for (const id of ['p2', 'p3']) assert.equal((await fx.main({ action: 'createOrder', productId: id })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'createOrder', productId: 'missing' })).error.code, 'NOT_FOUND')
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'createOrder', productId: 'p1' })).error.code, 'INVALID_INPUT')
  fx.setUser('buyer')
  assert.equal((await fx.main({ action: 'createOrder', productId: 'legacy' })).ok, true)
})

test('只有卖家能确认和完成，订单与商品状态一同更新，聊天历史保留', async () => {
  const fx = fixture()
  const id = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  assert.equal((await fx.main({ action: 'confirmOrder', id })).error.code, 'FORBIDDEN')
  assert.equal((await fx.main({ action: 'completeOrder', id })).error.code, 'FORBIDDEN')
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'confirmOrder', id })).data.status, 'confirmed')
  assert.equal((await fx.main({ action: 'confirmOrder', id })).error.code, 'INVALID_STATE')
  const completed = await fx.main({ action: 'completeOrder', id })
  assert.equal(completed.data.status, 'completed')
  assert.ok(completed.data.completedAt)
  assert.equal(fx.rows.products[0].status, 'sold')
  fx.setUser('buyer')
  assert.equal((await fx.main({ action: 'createOrder', productId: 'p1' })).error.code, 'INVALID_STATE')
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'p1'), false)
  assert.equal((await fx.main({ action: 'cancelOrder', id })).error.code, 'INVALID_STATE')
  assert.equal(fx.rows.conversations.length, 1)
  assert.equal(fx.rows.messages.length, 1)
})

test('非参与者不能读写订单；双方列表只返回各自订单', async () => {
  const fx = fixture()
  const id = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('outsider')
  assert.equal((await fx.main({ action: 'getOrder', id })).error.code, 'FORBIDDEN')
  for (const action of ['confirmOrder', 'completeOrder', 'cancelOrder']) assert.equal((await fx.main({ action, id })).error.code, 'FORBIDDEN')
  assert.deepEqual((await fx.main({ action: 'listOrders', role: 'buyer', buyerId: 'buyer' })).data, [])
  assert.deepEqual((await fx.main({ action: 'listOrders', role: 'seller', sellerId: 'seller' })).data, [])
  fx.setUser('buyer')
  assert.deepEqual((await fx.main({ action: 'listOrders', role: 'buyer' })).data.map(item => item.id), [id])
  assert.deepEqual((await fx.main({ action: 'listOrders', role: 'seller' })).data, [])
  fx.setUser('seller')
  assert.deepEqual((await fx.main({ action: 'listOrders', role: 'seller' })).data.map(item => item.id), [id])
  assert.deepEqual((await fx.main({ action: 'listOrders', role: 'buyer' })).data, [])
})

test('待面交时双方可取消；商品下架后不能确认订单', async () => {
  const fx = fixture()
  const id = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'confirmOrder', id })).ok, true)
  fx.setUser('buyer')
  const cancelled = await fx.main({ action: 'cancelOrder', id })
  assert.equal(cancelled.data.status, 'cancelled')
  assert.ok(cancelled.data.cancelledAt)
  assert.equal((await fx.main({ action: 'confirmOrder', id })).error.code, 'FORBIDDEN')
  const id2 = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.rows.products[0].status = 'offline'
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'confirmOrder', id: id2 })).error.code, 'INVALID_STATE')
})

test('新订单只提醒卖家，列表只返回当前角色未读，伪造身份字段无效', async () => {
  const fx = fixture()
  const created = await fx.main({ action: 'createOrder', productId: 'p1', buyerUnread: true, sellerUnread: false, buyerId: 'outsider' })
  const id = created.data.id
  assert.equal(fx.rows.orders[0].buyerUnread, false)
  assert.equal(fx.rows.orders[0].sellerUnread, true)
  assert.equal(created.data.unread, false)
  assert.equal('buyerUnread' in created.data, false)
  assert.equal('sellerUnread' in created.data, false)
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 0, seller: 0, total: 0 })
  fx.setUser('seller')
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 0, seller: 1, total: 1 })
  assert.equal((await fx.main({ action: 'listOrders', role: 'seller' })).data[0].unread, true)
  assert.equal((await fx.main({ action: 'getOrder', id })).data.unread, true)
  fx.setUser('outsider')
  assert.equal((await fx.main({ action: 'getOrder', id })).error.code, 'FORBIDDEN')
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'seller', sellerId: 'seller' })).data.cleared, 0)
  assert.equal(fx.rows.orders[0].sellerUnread, true)
})

test('确认和完成分别提醒买家，已读只清当前角色，不清对方角色', async () => {
  const fx = fixture()
  const id = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'confirmOrder', id })).ok, true)
  assert.equal(fx.rows.orders[0].buyerUnread, true)
  assert.equal(fx.rows.orders[0].sellerUnread, false)
  fx.setUser('buyer')
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 1, seller: 0, total: 1 })
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'buyer', buyerId: 'seller' })).data.cleared, 1)
  assert.equal(fx.rows.orders[0].buyerUnread, false)
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'completeOrder', id })).ok, true)
  assert.equal(fx.rows.orders[0].buyerUnread, true)
  assert.equal(fx.rows.orders[0].sellerUnread, false)
  assert.equal(fx.rows.products[0].status, 'sold')
  fx.setUser('buyer')
  assert.equal((await fx.main({ action: 'listOrders', role: 'buyer' })).data[0].unread, true)
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'seller' })).data.cleared, 0)
  assert.equal(fx.rows.orders[0].buyerUnread, true)
})

test('买家取消提醒卖家；卖家取消提醒买家，订单和聊天历史保留', async () => {
  const fx = fixture()
  const first = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  assert.equal((await fx.main({ action: 'cancelOrder', id: first })).ok, true)
  assert.equal(fx.rows.orders[0].buyerUnread, false)
  assert.equal(fx.rows.orders[0].sellerUnread, true)
  const second = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'buyer' })).data.cleared, 0)
  assert.equal(fx.rows.orders[0].sellerUnread, true)
  assert.equal((await fx.main({ action: 'cancelOrder', id: second })).ok, true)
  assert.equal(fx.rows.orders[1].buyerUnread, true)
  assert.equal(fx.rows.orders[1].sellerUnread, false)
  assert.equal(fx.rows.products[0].status, 'selling')
  assert.equal(fx.rows.conversations.length, 1)
  assert.equal(fx.rows.messages.length, 1)
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 0, seller: 1, total: 1 })
})

test('旧订单缺少未读字段时视为已读，按现有角色索引分批读取全部订单', async () => {
  const fx = fixture()
  fx.rows.orders.push({ _id: 'old', buyerId: 'buyer', sellerId: 'seller', productId: 'legacy', status: 'completed', createdAt: 1 })
  assert.equal((await fx.main({ action: 'listOrders', role: 'buyer' })).data[0].unread, false)
  for (let index = 0; index < 105; index++) fx.rows.orders.push({ _id: `past-${index}`, buyerId: 'buyer', sellerId: 'seller', productId: 'legacy', status: 'cancelled', buyerUnread: index % 2 === 0, sellerUnread: false, createdAt: index + 2 })
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 53, seller: 0, total: 53 })
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'buyer' })).data.cleared, 53)
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 0, seller: 0, total: 0 })
  assert.equal('buyerUnread' in fx.rows.orders[0], false)
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'other' })).error.code, 'INVALID_INPUT')
})

test('同一账号同时是买家和卖家时，标记一侧已读不清另一侧', async () => {
  const fx = fixture()
  const bought = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('seller')
  await fx.main({ action: 'confirmOrder', id: bought })
  fx.rows.products.push({ _id: 'p4', sellerId: 'buyer', school: campus.schoolName, title: '旧书架', images: [], price: 35, status: 'selling' })
  await fx.main({ action: 'createOrder', productId: 'p4' })
  fx.setUser('buyer')
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 1, seller: 1, total: 2 })
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'buyer' })).data.cleared, 1)
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 0, seller: 1, total: 1 })
  assert.equal((await fx.main({ action: 'markOrdersRead', role: 'seller' })).data.cleared, 1)
  assert.deepEqual((await fx.main({ action: 'getOrderUnreadSummary' })).data, { buyer: 0, seller: 0, total: 0 })
})

test('三个买家可分别待确认；卖家只选一人后商品预订并自动关闭其他订单', async () => {
  const fx = fixture()
  const ids = []
  for (const buyer of ['buyer', 'buyerB', 'buyerC']) {
    fx.setUser(buyer)
    const created = await fx.main({ action: 'createOrder', productId: 'p1' })
    assert.equal(created.data.status, 'pending')
    ids.push(created.data.id)
  }
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'getOrderUnreadSummary' })).data.seller, 3)
  assert.equal((await fx.main({ action: 'setProductStatus', id: 'p1', status: 'reserved' })).error.code, 'INVALID_INPUT')
  const selected = await fx.main({ action: 'confirmOrder', id: ids[0] })
  assert.equal(selected.data.status, 'confirmed')
  assert.equal(fx.rows.products[0].status, 'reserved')
  assert.equal(fx.rows.orders.filter(item => item.productId === 'p1' && item.status === 'confirmed').length, 1)
  for (const id of ids.slice(1)) {
    const other = fx.rows.orders.find(item => item._id === id)
    assert.equal(other.status, 'cancelled')
    assert.equal(other.cancelReason, 'seller_selected_other_buyer')
    assert.equal(other.activeKey, `closed_${id}`)
    assert.ok(other.cancelledAt)
    assert.equal(other.buyerUnread, true)
    assert.equal(other.sellerUnread, false)
  }
  assert.equal((await fx.main({ action: 'getOrderUnreadSummary' })).data.total, 0)
  assert.equal((await fx.main({ action: 'confirmOrder', id: ids[1] })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'updateProduct', id: 'p1', product: {} })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'deleteProduct', id: 'p1' })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'setProductStatus', id: 'p1', status: 'offline' })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'p1' && item.status === 'reserved'), true)
  fx.setUser('buyerB')
  assert.equal((await fx.main({ action: 'getOrderUnreadSummary' })).data.buyer, 1)
  assert.equal((await fx.main({ action: 'getOrder', id: ids[1] })).data.cancelReason, 'seller_selected_other_buyer')
  assert.equal((await fx.main({ action: 'createOrder', productId: 'p1' })).error.code, 'INVALID_STATE')
  fx.setUser('outsider')
  assert.equal((await fx.main({ action: 'cancelOrder', id: ids[0] })).error.code, 'FORBIDDEN')
  assert.equal(fx.rows.conversations.length, 1)
  assert.equal(fx.rows.messages.length, 1)
})

test('已确认订单取消后商品重新在售，自动取消过的买家可再次下单；完成后商品已售', async () => {
  const fx = fixture()
  const first = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('buyerB')
  const displaced = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('seller')
  await fx.main({ action: 'confirmOrder', id: first })
  fx.setUser('buyer')
  const cancelled = await fx.main({ action: 'cancelOrder', id: first })
  assert.equal(cancelled.data.status, 'cancelled')
  assert.equal(fx.rows.products[0].status, 'selling')
  assert.equal(fx.rows.orders.find(item => item._id === first).activeKey, `closed_${first}`)
  fx.setUser('buyerB')
  const retry = await fx.main({ action: 'createOrder', productId: 'p1' })
  assert.equal(retry.ok, true)
  assert.notEqual(retry.data.id, displaced)
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'confirmOrder', id: retry.data.id })).ok, true)
  assert.equal(fx.rows.products[0].status, 'reserved')
  assert.equal((await fx.main({ action: 'completeOrder', id: retry.data.id })).ok, true)
  assert.equal(fx.rows.products[0].status, 'sold')
  assert.equal((await fx.main({ action: 'cancelOrder', id: retry.data.id })).error.code, 'INVALID_STATE')
})

test('并发确认最多一个成功；旧版已确认订单仍能完成', async () => {
  const fx = fixture()
  const first = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('buyerB')
  const second = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('seller')
  const results = await Promise.all([fx.main({ action: 'confirmOrder', id: first }), fx.main({ action: 'confirmOrder', id: second })])
  assert.equal(results.filter(item => item.ok).length, 1)
  assert.equal(fx.rows.orders.filter(item => item.status === 'confirmed').length, 1)
  const legacy = fixture()
  const id = (await legacy.main({ action: 'createOrder', productId: 'p1' })).data.id
  legacy.rows.orders[0].status = 'confirmed'
  legacy.setUser('buyerB')
  assert.equal((await legacy.main({ action: 'createOrder', productId: 'p1' })).error.code, 'INVALID_STATE')
  legacy.setUser('seller')
  assert.equal((await legacy.main({ action: 'completeOrder', id })).ok, true)
  assert.equal(legacy.rows.products[0].status, 'sold')
})

test('管理员下架交易中商品后，取消订单不会擅自重新上架', async () => {
  const fx = fixture()
  const id = (await fx.main({ action: 'createOrder', productId: 'p1' })).data.id
  fx.setUser('seller')
  await fx.main({ action: 'confirmOrder', id })
  fx.rows.products[0].status = 'offline'
  fx.rows.products[0].moderationStatus = 'blocked'
  fx.setUser('buyer')
  assert.equal((await fx.main({ action: 'cancelOrder', id })).ok, true)
  assert.equal(fx.rows.products[0].status, 'offline')
})
