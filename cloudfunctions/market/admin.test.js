const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const campus = require('./campus.json')
const ADMIN_OPENID = 'test_admin_openid_12345678901234567890'
const DISABLED_OPENID = 'test_disabled_openid_12345678901234567890'
const WRONG_ROLE_OPENID = 'test_wrong_role_openid_12345678901234567890'

function fixture() {
  let openid = 'buyer'
  const rows = {
    admins: [
      { _id: 'generated_admin_1', openid: ADMIN_OPENID, role: 'admin', enabled: true, createdAt: 1 },
      { _id: 'generated_admin_2', openid: DISABLED_OPENID, role: 'admin', enabled: false, createdAt: 1 },
      { _id: 'generated_admin_3', openid: WRONG_ROLE_OPENID, role: 'user', enabled: true, createdAt: 1 }
    ],
    users: [{ _id: 'seller', nickname: '卖家同学', avatar: '卖' }],
    products: [
      { _id: 'p1', sellerId: 'seller', school: campus.schoolName, title: '闲置教材', images: ['cover.jpg'], price: 25, status: 'selling', createdAt: 20 },
      { _id: 'p2', sellerId: 'seller', school: campus.schoolName, title: '旧版教材', images: [], price: 10, status: 'active', createdAt: 10 },
      { _id: 'foreign', sellerId: 'seller', school: '其他学校', title: '外校商品', images: [], price: 8, status: 'selling', createdAt: 30 }
    ],
    favorites: [{ _id: 'fav1', productId: 'p1', userId: 'buyer', createdAt: 1 }],
    reports: [
      { _id: 'r1', type: 'product', school: campus.schoolName, productId: 'p1', reporterId: 'buyer', reason: 'misleading', description: '商品描述与图片不符', status: 'pending', createdAt: 5 },
      { _id: 'r2', type: 'product', school: campus.schoolName, productId: 'p2', reporterId: 'buyer', reason: 'fraud', status: 'pending', createdAt: 4 },
      { _id: 'r_missing', type: 'product', school: campus.schoolName, productId: 'deleted', reporterId: 'buyer', reason: 'other', status: 'pending', createdAt: 3 },
      { _id: 'cleanup', type: 'image_cleanup', school: campus.schoolName, productId: 'p1', status: 'pending', createdAt: 6 }
    ],
    conversations: [{ _id: 'conv1', productId: 'p1' }], messages: [{ _id: 'msg1', conversationId: 'conv1' }], orders: [{ _id: 'order1', productId: 'p1' }]
  }
  const command = { in: values => ({ op: 'in', values }), neq: value => ({ op: 'neq', value }) }
  const matches = (row, query) => Object.entries(query).every(([key, expected]) => {
    if (expected?.op === 'in') return expected.values.includes(row[key])
    if (expected?.op === 'neq') return row[key] !== expected.value
    return row[key] === expected
  })
  const db = {
    command,
    collection(name) {
      if (!rows[name]) throw new Error(`Unknown collection ${name}`)
      return {
        limit(count) { return { async get() { return { data: rows[name].slice(0, count) } } } },
        where(query) {
          const selected = () => rows[name].filter(row => matches(row, query))
          return {
            limit(count) { return { async get() { return { data: selected().slice(0, count) } } } },
            orderBy(field, direction) { return {
              limit(count) { return { async get() { return { data: selected().sort((a, b) => direction === 'desc' ? (b[field] || 0) - (a[field] || 0) : (a[field] || 0) - (b[field] || 0)).slice(0, count) } } } }
            } }
          }
        },
        doc(id) { return {
          async get() { return { data: rows[name].find(row => row._id === id) || null } },
          async update({ data }) { const row = rows[name].find(row => row._id === id); if (!row) throw new Error('missing doc'); Object.assign(row, data) }
        } }
      }
    },
    async runTransaction(callback) {
      const snapshot = structuredClone(rows)
      try { return await callback({ collection: name => db.collection(name) }) }
      catch (error) { for (const name of Object.keys(rows)) rows[name] = snapshot[name]; throw error }
    }
  }
  const cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return db }, getWXContext() { return { OPENID: openid } } }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  let main
  try { delete require.cache[require.resolve('./index')]; ({ main } = require('./index')) }
  finally { Module._load = originalLoad }
  return { main, rows, setUser(value) { openid = value } }
}

test('管理员身份只由真实 OPENID 和 admins 文档决定；伪造字段无效', async () => {
  const fx = fixture()
  assert.ok(ADMIN_OPENID.length > 24)
  assert.notEqual(fx.rows.admins[0]._id, ADMIN_OPENID)
  const scan = {
    adminCount: 3, openidFieldCount: 3, currentOpenidLength: 'buyer'.length,
    storedOpenidLengths: [ADMIN_OPENID.length, DISABLED_OPENID.length, WRONG_ROLE_OPENID.length]
  }
  assert.deepEqual((await fx.main({ action: 'getAdminStatus', openid: ADMIN_OPENID, isAdmin: true, role: 'admin' })).data, {
    isAdmin: false, debug: {
      adminFound: false, roleMatches: false, enabledMatches: false,
      ...scan, exactMatchByScan: false, trimmedMatchByScan: false
    }
  })
  for (const action of ['adminListProducts', 'adminTakeDownProduct', 'adminListReports', 'adminResolveReport']) {
    const result = await fx.main({ action, openid: ADMIN_OPENID, userId: ADMIN_OPENID, isAdmin: true, role: 'admin', id: 'p1', reason: '违规商品', resolution: 'dismiss' })
    assert.equal(result.error.code, 'FORBIDDEN', action)
  }
  for (const [who, debug] of [
    [DISABLED_OPENID, { adminFound: true, roleMatches: true, enabledMatches: false }],
    [WRONG_ROLE_OPENID, { adminFound: true, roleMatches: false, enabledMatches: true }]
  ]) {
    fx.setUser(who)
    assert.deepEqual((await fx.main({ action: 'getAdminStatus' })).data, {
      isAdmin: false, debug: {
        ...debug, ...scan, currentOpenidLength: who.length,
        exactMatchByScan: true, trimmedMatchByScan: true
      }
    })
    assert.equal((await fx.main({ action: 'adminListProducts' })).error.code, 'FORBIDDEN')
  }
  fx.setUser('')
  assert.equal((await fx.main({ action: 'getAdminStatus', openid: ADMIN_OPENID })).error.code, 'UNAUTHENTICATED')
  fx.setUser(ADMIN_OPENID)
  const status = (await fx.main({ action: 'getAdminStatus' })).data
  assert.deepEqual(status, {
    isAdmin: true, debug: {
      adminFound: true, roleMatches: true, enabledMatches: true,
      ...scan, currentOpenidLength: ADMIN_OPENID.length,
      exactMatchByScan: true, trimmedMatchByScan: true
    }
  })
  assert.equal(JSON.stringify(status).includes(ADMIN_OPENID), false)
  assert.equal((await fx.main({ action: 'adminListProducts' })).ok, true)
})

test('管理员扫描诊断只返回最多 20 条记录的计数和长度；空格匹配不授予权限', async () => {
  const fx = fixture()
  fx.rows.admins[0].openid = ` ${ADMIN_OPENID} `
  fx.rows.admins.push({ _id: 'missing_openid', role: 'admin', enabled: true })
  fx.setUser(ADMIN_OPENID)
  const status = (await fx.main({ action: 'getAdminStatus' })).data
  assert.deepEqual(status, {
    isAdmin: false, debug: {
      adminFound: false, roleMatches: false, enabledMatches: false,
      adminCount: 4, openidFieldCount: 3,
      exactMatchByScan: false, trimmedMatchByScan: true,
      currentOpenidLength: ADMIN_OPENID.length,
      storedOpenidLengths: [ADMIN_OPENID.length + 2, DISABLED_OPENID.length, WRONG_ROLE_OPENID.length]
    }
  })
  assert.equal((await fx.main({ action: 'adminListProducts' })).error.code, 'FORBIDDEN')
  assert.equal(JSON.stringify(status).includes(ADMIN_OPENID), false)

  fx.rows.admins.push(...Array.from({ length: 20 }, (_, index) => ({
    _id: `extra_${index}`, openid: `extra_${index}`, role: 'user', enabled: false
  })))
  const limited = (await fx.main({ action: 'getAdminStatus' })).data.debug
  assert.equal(limited.adminCount, 20)
  assert.equal(limited.openidFieldCount, 19)
  assert.equal(limited.storedOpenidLengths.length, 19)
})

test('管理员只见本校商品和商品举报，内部清理记录不混入列表', async () => {
  const fx = fixture(); fx.setUser(ADMIN_OPENID)
  const products = (await fx.main({ action: 'adminListProducts' })).data
  assert.deepEqual(products.map(item => item.id), ['p1', 'p2'])
  assert.equal(products[0].sellerNickname, '卖家同学')
  assert.equal(products[1].status, 'selling', '旧版 active 视为在售')
  const reports = (await fx.main({ action: 'adminListReports' })).data
  assert.deepEqual(reports.map(item => item.id), ['r1', 'r2', 'r_missing'])
  assert.equal(reports[2].productTitle, '商品已删除')
})

test('管理员下架后公共流和收藏流隐藏商品，卖家不能伪造重新上架；历史保留', async () => {
  const fx = fixture(); fx.setUser(ADMIN_OPENID)
  assert.equal((await fx.main({ action: 'adminTakeDownProduct', id: 'foreign', reason: '违规商品' })).error.code, 'NOT_FOUND')
  const result = await fx.main({ action: 'adminTakeDownProduct', id: 'p1', reason: '违反平台商品发布规范', moderatedBy: 'buyer', status: 'selling' })
  assert.equal(result.ok, true)
  assert.equal(fx.rows.products[0].status, 'offline')
  assert.equal(fx.rows.products[0].moderationStatus, 'blocked')
  assert.equal(fx.rows.products[0].moderatedBy, ADMIN_OPENID)
  fx.setUser('buyer')
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'p1'), false)
  assert.equal((await fx.main({ action: 'getFavorites' })).data.some(item => item._id === 'p1'), false)
  assert.equal((await fx.main({ action: 'setFavorite', id: 'p1', favorited: true })).error.code, 'NOT_FOUND')
  fx.setUser('seller')
  assert.equal((await fx.main({ action: 'setProductStatus', id: 'p1', status: 'selling' })).error.code, 'FORBIDDEN')
  assert.equal(fx.rows.conversations.length, 1)
  assert.equal(fx.rows.messages.length, 1)
  assert.equal(fx.rows.orders.length, 1)
})

test('举报驳回不下架，确认违规则下架；已处理举报不可重复处理', async () => {
  const fx = fixture(); fx.setUser(ADMIN_OPENID)
  assert.equal((await fx.main({ action: 'adminResolveReport', id: 'r1', resolution: 'dismiss' })).ok, true)
  assert.equal(fx.rows.reports[0].status, 'dismissed')
  assert.equal(fx.rows.reports[0].resolvedBy, ADMIN_OPENID)
  assert.equal(fx.rows.products[0].status, 'selling')
  assert.equal((await fx.main({ action: 'adminResolveReport', id: 'r1', resolution: 'takedown' })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'adminResolveReport', id: 'r2', resolution: 'takedown' })).ok, true)
  assert.equal(fx.rows.reports[1].status, 'resolved')
  assert.equal(fx.rows.reports[1].resolution, 'takedown')
  assert.equal(fx.rows.products[1].status, 'offline')
  assert.equal(fx.rows.products[1].moderationStatus, 'blocked')
  assert.equal((await fx.main({ action: 'adminResolveReport', id: 'r_missing', resolution: 'takedown' })).ok, true)
  assert.equal(fx.rows.reports[2].status, 'resolved')
  assert.equal((await fx.main({ action: 'adminResolveReport', id: 'cleanup', resolution: 'dismiss' })).error.code, 'NOT_FOUND')
  assert.equal((await fx.main({ action: 'adminResolveReport', id: 'r2', resolution: 'other' })).error.code, 'INVALID_INPUT')
})
