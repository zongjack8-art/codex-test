const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const campus = require('./campus.json')
const { reviewId } = require('./reviews')

function fixture() {
  let openid = 'buyer', beforeTransaction = () => {}
  const rows = { orders: [{ _id: 'o1', productId: 'p1', buyerId: 'buyer', sellerId: 'seller', status: 'completed' }], reviews: [] }
  const db = { command: {}, collection(name) {
    rows[name] ||= []
    return {
      where(query) {
        let offset = 0, limit = Infinity, sort = null
        const cursor = {
          skip(value) { offset = value; return cursor }, limit(value) { limit = value; return cursor },
          orderBy(field, direction) { sort = [field, direction]; return cursor },
          async get() {
            const selected = rows[name].filter(row => Object.entries(query).every(([key, value]) => row[key] === value))
            if (sort) selected.sort((a, b) => sort[1] === 'desc' ? b[sort[0]] - a[sort[0]] : a[sort[0]] - b[sort[0]])
            return { data: selected.slice(offset, offset + limit) }
          }
        }
        return cursor
      },
      doc(id) { return { async get() { return { data: rows[name].find(row => row._id === id) || null } } } },
      async add({ data }) {
        if (rows[name].some(row => row._id === data._id || name === 'reviews' && row.orderId === data.orderId)) throw new Error('duplicate key')
        rows[name].push({ ...data }); return { _id: data._id }
      }
    }
  }, async runTransaction(callback) { beforeTransaction(); return callback({ collection: name => db.collection(name) }) } }
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: openid }) }
  const originalLoad = Module._load
  Module._load = function(request, parent, isMain) {
    return request === 'wx-server-sdk' ? cloud : originalLoad.call(this, request, parent, isMain)
  }
  let main
  try { delete require.cache[require.resolve('./index')]; ({ main } = require('./index')) }
  finally { Module._load = originalLoad }
  return { main, rows, setUser(value) { openid = value }, beforeTransaction(callback) { beforeTransaction = callback } }
}
const create = (fx, params = {}) => fx.main({ action: 'createReview', orderId: 'o1', rating: 5, ...params })

test('评价身份、商品、卖家和学校均来自真实上下文及订单；订单双方仅见展示字段', async () => {
  const fx = fixture()
  assert.deepEqual((await fx.main({ action: 'getOrderReview', orderId: 'o1' })).data, { reviewed: false })
  const result = await create(fx, { buyerId: 'fake', sellerId: 'fake', productId: 'fake', school: '其他学校', content: ' 面交顺利，教材保存得很好 ' })
  assert.deepEqual(result.data, { created: true })
  const saved = fx.rows.reviews[0]
  assert.equal(saved.buyerId, 'buyer'); assert.equal(saved.sellerId, 'seller'); assert.equal(saved.productId, 'p1')
  assert.equal(saved.school, campus.schoolName); assert.equal(saved.content, '面交顺利，教材保存得很好')
  assert.equal(saved._id, reviewId('o1')); assert.ok(saved._id.length <= 24)
  for (const who of ['buyer', 'seller']) {
    fx.setUser(who)
    assert.deepEqual((await fx.main({ action: 'getOrderReview', orderId: 'o1' })).data, {
      reviewed: true, review: { rating: 5, content: saved.content, createdAt: saved.createdAt }
    })
  }
})

test('非买家、非参与者、未登录、自己交易及外校订单均不能绕过评价权限', async () => {
  const fx = fixture()
  for (const who of ['seller', 'outsider']) {
    fx.setUser(who)
    assert.equal((await create(fx, { buyerId: 'buyer', openid: 'buyer' })).error.code, 'FORBIDDEN')
  }
  assert.equal((await fx.main({ action: 'getOrderReview', orderId: 'o1' })).error.code, 'FORBIDDEN')
  fx.setUser('')
  assert.equal((await create(fx, { openid: 'buyer' })).error.code, 'UNAUTHENTICATED')
  fx.setUser('buyer')
  fx.rows.orders[0].sellerId = 'buyer'
  assert.equal((await create(fx)).error.code, 'FORBIDDEN')
  fx.rows.orders[0].sellerId = 'seller'; fx.rows.orders[0].school = '其他学校'
  assert.equal((await create(fx)).error.code, 'NOT_FOUND')
  fx.rows.orders = []
  assert.equal((await create(fx)).error.code, 'NOT_FOUND')
})

test('只允许 completed 订单且在事务中重新检查状态；评分和文字严格校验', async () => {
  const fx = fixture()
  for (const status of ['pending', 'confirmed', 'cancelled', undefined]) {
    fx.rows.orders[0].status = status
    assert.equal((await create(fx)).error.code, 'INVALID_STATE')
  }
  fx.rows.orders[0].status = 'completed'
  for (const rating of [0, 6, 1.5, '5', null]) assert.equal((await create(fx, { rating })).error.code, 'INVALID_INPUT')
  assert.equal((await create(fx, { content: '评'.repeat(201) })).error.code, 'INVALID_INPUT')
  assert.equal((await create(fx, { content: {} })).error.code, 'INVALID_INPUT')
  fx.beforeTransaction(() => { fx.rows.orders[0].status = 'cancelled' })
  assert.equal((await create(fx)).error.code, 'INVALID_STATE')
  assert.equal(fx.rows.reviews.length, 0)
})

test('同一订单不能重复评价，并发提交也只写入一条；重复评价不改历史', async () => {
  const fx = fixture()
  const results = await Promise.all([create(fx, { rating: 1 }), create(fx, { rating: 5 })])
  assert.equal(results.filter(result => result.ok).length, 1)
  assert.equal(results.find(result => !result.ok).error.code, 'ALREADY_REVIEWED')
  assert.equal(fx.rows.reviews.length, 1)
  const saved = structuredClone(fx.rows.reviews[0])
  assert.equal((await create(fx)).error.code, 'ALREADY_REVIEWED')
  assert.deepEqual(fx.rows.reviews[0], saved)
})

test('信用汇总跨批次仅统计本校；公开列表最多 20 条且不泄露买家身份', async () => {
  const fx = fixture()
  assert.deepEqual((await fx.main({ action: 'getSellerReviewSummary', sellerId: 'seller' })).data, { averageRating: 0, reviewCount: 0 })
  fx.rows.reviews = Array.from({ length: 105 }, (_, index) => ({
    _id: `r${index}`, orderId: `o${index}`, buyerId: 'private_buyer', sellerId: 'seller',
    rating: index === 0 ? 1 : 5, content: '交易顺利', createdAt: index, school: campus.schoolName
  }))
  fx.rows.reviews.push({ ...fx.rows.reviews[0], _id: 'foreign', createdAt: 999, school: '其他学校' })
  assert.deepEqual((await fx.main({ action: 'getSellerReviewSummary', sellerId: 'seller' })).data, { averageRating: 5, reviewCount: 105 })
  const list = (await fx.main({ action: 'listSellerReviews', sellerId: 'seller' })).data
  assert.equal(list.length, 20); assert.equal(list[0].createdAt, 104); assert.equal(list[19].createdAt, 85)
  for (const item of list) assert.deepEqual(Object.keys(item).sort(), ['content', 'createdAt', 'rating'])
  fx.rows.reviews = fx.rows.reviews.slice(0, 3)
  assert.deepEqual((await fx.main({ action: 'getSellerReviewSummary', sellerId: 'seller' })).data, { averageRating: 3.7, reviewCount: 3 })
})

test('reviews 的客户端数据库权限完全关闭', () => {
  assert.deepEqual(require('../../cloudbase/rules/reviews.json'), { read: false, write: false })
})
