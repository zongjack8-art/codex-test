const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const campus = require('./campus.json')
const { viewId } = require('./recent-views')

function fixture() {
  let openid = 'buyerA'
  const product = (id, status = 'selling', school = campus.schoolName) => ({
    _id: id, sellerId: 'seller', school, title: `好物 ${id}`, description: '校内面交',
    price: 20, category: 'books', condition: '九成新', images: [], location: '校内面交', status, createdAt: 1
  })
  const rows = {
    users: [{ _id: 'seller', nickname: '卖家', avatar: '卖', campus: '校内' }],
    products: [product('p1'), product('p2', 'reserved'), product('p3', 'sold'), product('offline', 'offline'), product('foreign', 'selling', '其他学校'), product('blocked')],
    recentViews: [], favorites: []
  }
  rows.products.find(item => item._id === 'blocked').moderationStatus = 'blocked'
  const command = { in: values => ({ in: values }) }
  const matches = (row, query) => Object.entries(query).every(([key, expected]) => expected && typeof expected === 'object' && 'in' in expected ? expected.in.includes(row[key]) : row[key] === expected)
  const db = { command, collection(name) {
    const collectionRows = () => rows[name] || []
    return {
      where(query) {
        let limit = Infinity; let offset = 0; let sort = null
        const cursor = {
          limit(value) { limit = value; return cursor },
          skip(value) { offset = value; return cursor },
          orderBy(field, direction) { sort = [field, direction]; return cursor },
          async get() {
            const found = collectionRows().filter(row => matches(row, query))
            if (sort) found.sort((a, b) => (sort[1] === 'desc' ? -1 : 1) * ((a[sort[0]] || 0) - (b[sort[0]] || 0)))
            return { data: found.slice(offset, offset + limit) }
          },
          async remove() { rows[name] = collectionRows().filter(row => !matches(row, query)) }
        }
        return cursor
      },
      async add({ data }) {
        if (collectionRows().some(row => row._id === data._id)) throw new Error('duplicate _id')
        rows[name].push({ ...data })
        return { _id: data._id }
      },
      doc(id) { return {
        async update({ data }) { Object.assign(collectionRows().find(row => row._id === id), data) },
        async remove() { rows[name] = collectionRows().filter(row => row._id !== id) }
      } }
    }
  } }
  const cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return db }, getWXContext() { return { OPENID: openid } } }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  let main
  try { delete require.cache[require.resolve('./index')]; ({ main } = require('./index')) }
  finally { Module._load = originalLoad }
  return { main, rows, product, setUser(value) { openid = value } }
}

test('浏览使用真实 OPENID，重复浏览更新时间并置顶；不同账号与学校隔离', async () => {
  const fx = fixture()
  assert.equal((await fx.main({ action: 'recordProductView', productId: 'p1', userId: 'buyerB', openid: 'buyerB', school: '其他学校' })).ok, true)
  assert.equal(fx.rows.recentViews[0].userId, 'buyerA')
  assert.equal(fx.rows.recentViews[0].school, campus.schoolName)
  assert.equal(fx.rows.recentViews[0]._id.length, 24)
  const firstTime = fx.rows.recentViews[0].viewedAt
  await fx.main({ action: 'recordProductView', productId: 'p2' })
  await fx.main({ action: 'recordProductView', productId: 'p1' })
  assert.equal(fx.rows.recentViews.length, 2)
  assert.ok(fx.rows.recentViews.find(row => row.productId === 'p1').viewedAt > firstTime)
  assert.deepEqual((await fx.main({ action: 'listRecentViews' })).data.map(item => item._id), ['p1', 'p2'])
  assert.equal((await fx.main({ action: 'listRecentViews' })).data.every(item => !('sellerId' in item) && item.seller.id === ''), true)
  fx.setUser('buyerB')
  assert.deepEqual((await fx.main({ action: 'listRecentViews', userId: 'buyerA' })).data, [])
  assert.equal((await fx.main({ action: 'recordProductView', productId: 'p3' })).ok, true)
  assert.deepEqual((await fx.main({ action: 'listRecentViews' })).data.map(item => item._id), ['p3'])
  fx.setUser('buyerA')
  fx.rows.recentViews.push({ _id: 'foreignView', userId: 'buyerA', productId: 'foreign', school: '其他学校', viewedAt: Date.now() + 100 })
  assert.deepEqual((await fx.main({ action: 'listRecentViews' })).data.map(item => item._id), ['p1', 'p2'])
  assert.equal((await fx.main({ action: 'clearRecentViews', userId: 'buyerB' })).ok, true)
  assert.equal(fx.rows.recentViews.some(row => row.userId === 'buyerA' && row.school === campus.schoolName), false)
  assert.equal(fx.rows.recentViews.some(row => row.userId === 'buyerB'), true)
  assert.equal(fx.rows.recentViews.some(row => row._id === 'foreignView'), true)
})

test('不存在、外校、下架或屏蔽商品不记录，失效记录不使列表失败', async () => {
  const fx = fixture()
  for (const id of ['missing', 'foreign', 'offline', 'blocked']) {
    assert.equal((await fx.main({ action: 'recordProductView', productId: id })).error.code, 'NOT_FOUND')
  }
  assert.equal((await fx.main({ action: 'recordProductView', productId: '' })).error.code, 'INVALID_INPUT')
  assert.equal(fx.rows.recentViews.length, 0)
  for (const id of ['p1', 'p2', 'p3']) await fx.main({ action: 'recordProductView', productId: id })
  fx.rows.products = fx.rows.products.filter(row => row._id !== 'p1')
  fx.rows.products.find(row => row._id === 'p2').status = 'offline'
  assert.deepEqual((await fx.main({ action: 'listRecentViews' })).data.map(item => item._id), ['p3'])
})

test('浏览记录 ID 若与其他用户记录冲突，不会覆盖他人数据', async () => {
  const fx = fixture()
  fx.rows.recentViews.push({ _id: viewId('buyerA', 'p1'), userId: 'buyerB', productId: 'p1', school: campus.schoolName, viewedAt: 1 })
  assert.equal((await fx.main({ action: 'recordProductView', productId: 'p1' })).error.code, 'FORBIDDEN')
  assert.equal(fx.rows.recentViews[0].viewedAt, 1)
})

test('最多保留当前用户最近 50 条，旧记录自动清理且不影响他人', async () => {
  const fx = fixture()
  fx.rows.recentViews.push({ _id: viewId('buyerB', 'p1'), userId: 'buyerB', productId: 'p1', school: campus.schoolName, viewedAt: 1 })
  for (let index = 0; index < 52; index++) {
    const id = `extra${index}`
    fx.rows.products.push(fx.product(id))
    assert.equal((await fx.main({ action: 'recordProductView', productId: id })).ok, true)
  }
  const own = fx.rows.recentViews.filter(row => row.userId === 'buyerA')
  assert.equal(own.length, 50)
  assert.equal(own.some(row => row.productId === 'extra0'), false)
  assert.equal(own.some(row => row.productId === 'extra1'), false)
  assert.equal((await fx.main({ action: 'listRecentViews' })).data.length, 50)
  assert.equal(fx.rows.recentViews.some(row => row.userId === 'buyerB'), true)
})

test('收藏列表保留在售、预订和已售，旧收藏无时间仍可见，失效项安全过滤', async () => {
  const fx = fixture()
  fx.rows.favorites.push(
    { _id: 'f1', userId: 'buyerA', productId: 'p1' },
    { _id: 'f2', userId: 'buyerA', productId: 'p2', createdAt: 20 },
    { _id: 'f3', userId: 'buyerA', productId: 'p3', createdAt: 30 },
    { _id: 'f4', userId: 'buyerA', productId: 'offline', createdAt: 40 },
    { _id: 'f5', userId: 'buyerA', productId: 'foreign', createdAt: 50 },
    { _id: 'f6', userId: 'buyerA', productId: 'deleted', createdAt: 60 },
    { _id: 'f7', userId: 'buyerA', productId: 'blocked', createdAt: 70 }
  )
  const result = await fx.main({ action: 'getFavorites' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.map(item => item._id), ['p3', 'p2', 'p1'])
  assert.deepEqual(result.data.map(item => item.status), ['sold', 'reserved', 'selling'])
  assert.equal(result.data.every(item => !('sellerId' in item) && item.seller.id === ''), true)
  fx.setUser('buyerB')
  assert.deepEqual((await fx.main({ action: 'getFavorites' })).data, [])
})
