const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTs(relative, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', relative), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const moduleLike = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`)
    return modules[name]
  }, moduleLike, moduleLike.exports)
  return moduleLike.exports
}

test('Mock 浏览记录按用户隔离、去重置顶、限制 50 条并可单独清空', async () => {
  const storage = new Map()
  let activeUser = 'A'
  const products = new Map([
    ['p1', { id: 'p1', school: '天津师范大学', status: 'selling' }],
    ['p2', { id: 'p2', school: '天津师范大学', status: 'reserved' }],
    ['sold', { id: 'sold', school: '天津师范大学', status: 'sold' }],
    ['offline', { id: 'offline', school: '天津师范大学', status: 'offline' }],
    ['foreign', { id: 'foreign', school: '其他学校', status: 'selling' }]
  ])
  const history = loadTs('services/recentViews.ts', {
    '../config/campus': { campusConfig: { schoolName: '天津师范大学' } },
    '../data/mock': { demoUser: { id: 'demo' } },
    './auth': { getSession: () => ({ user: { id: activeUser } }) },
    './cloudbase': {}, './mode': { getDataMode: () => 'mock' },
    './products': { getProduct: async id => id === 'broken' ? Promise.reject(new Error('network')) : products.get(id) || null },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) }
  })
  assert.equal(await history.recordProductView('p1'), true)
  assert.equal(await history.recordProductView('p2'), true)
  const earlier = storage.get('campusmarket.recentViews.v1').find(row => row.productId === 'p1').viewedAt
  await history.recordProductView('p1')
  assert.deepEqual((await history.listRecentViews()).map(item => item.id), ['p1', 'p2'])
  assert.equal(storage.get('campusmarket.recentViews.v1').filter(row => row.productId === 'p1').length, 1)
  assert.ok(storage.get('campusmarket.recentViews.v1').find(row => row.productId === 'p1').viewedAt > earlier)
  for (const id of ['', 'missing', 'offline', 'foreign']) assert.equal(await history.recordProductView(id), false)
  await assert.rejects(history.recordProductView('broken'), /network/)
  assert.equal(storage.get('campusmarket.recentViews.v1').length, 2)
  activeUser = 'B'
  await history.recordProductView('sold')
  assert.deepEqual((await history.listRecentViews()).map(item => item.id), ['sold'])
  activeUser = 'A'
  assert.deepEqual((await history.listRecentViews()).map(item => item.id), ['p1', 'p2'])
  for (let index = 0; index < 51; index++) {
    const id = `extra${index}`
    products.set(id, { id, status: 'selling', school: '天津师范大学' })
    await history.recordProductView(id)
  }
  assert.equal((await history.listRecentViews()).length, 50)
  assert.equal(storage.get('campusmarket.recentViews.v1').filter(row => row.userId === 'A').length, 50)
  products.delete('extra50')
  assert.equal((await history.listRecentViews()).some(item => item.id === 'extra50'), false)
  await history.clearRecentViews()
  assert.deepEqual(await history.listRecentViews(), [])
  activeUser = 'B'
  assert.deepEqual((await history.listRecentViews()).map(item => item.id), ['sold'])
})

test('Mock 收藏保留预订与已售，过滤失效项，按最近收藏排列且取消后立即消失', async () => {
  const owner = { id: 'demo', nickname: '同学', school: '天津师范大学', campus: '校内', avatar: '同' }
  const products = ['selling', 'reserved', 'sold', 'offline', 'removed', 'blocked'].map((status, index) => ({
    id: `p${index}`, title: '校园好物', description: '校内面交', price: 20, category: 'books',
    condition: '九成新', images: [], campus: '校内', seller: owner, school: '天津师范大学',
    createdAt: '2026-10-01T00:00:00Z', status, ...(status === 'blocked' ? { moderationStatus: 'blocked' } : {})
  }))
  const storage = new Map([
    ['campusmarket.products.v2', products],
    ['campusmarket.favorites.v2', ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'deleted']]
  ])
  const service = loadTs('services/products.ts', {
    '../data/mock': { demoUser: owner, mockProducts: [] },
    '../config/campus': { campusConfig: { schoolName: '天津师范大学', campusName: '校内', defaultTradeLocation: '校内' }, normalizeLegacyLocation: value => value || '校内' },
    './auth': { getSession: () => ({ user: owner }) },
    './api': {}, './cloudbase': {}, './mode': { getDataMode: () => 'mock' },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) },
    './upload': { removeMockImage: async () => undefined }
  })
  const { filterFavoriteProducts } = loadTs('utils/favorites.ts')
  const favoriteItems = await service.getFavorites()
  assert.deepEqual(favoriteItems.map(item => item.id), ['p2', 'p1', 'p0'])
  assert.deepEqual(filterFavoriteProducts(favoriteItems, 'selling').map(item => item.id), ['p0'])
  assert.deepEqual(filterFavoriteProducts(favoriteItems, 'reserved').map(item => item.id), ['p1'])
  assert.deepEqual(filterFavoriteProducts(favoriteItems, 'sold').map(item => item.id), ['p2'])
  assert.equal(await service.toggleFavorite('p1'), false)
  assert.deepEqual((await service.getFavorites()).map(item => item.id), ['p2', 'p0'])
  assert.equal((await service.getFavorites()).some(item => item.id === 'p1'), false)
})
