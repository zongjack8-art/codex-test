const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

test('Mock 商品管理保留本地持久化、公共在售过滤与所有权限制', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/products.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const owner = { id: 'demo', nickname: '演示同学', avatar: '同', campus: '校内' }
  const storage = new Map()
  const products = [
    { id: 'own', title: '旧书', description: '书页完整，校内面交', price: 20, category: 'books', condition: '九成新', images: [], campus: '校内面交', seller: owner, createdAt: '2026-01-01T00:00:00.000Z', status: 'selling' },
    { id: 'other', title: '相机', description: '可试机', price: 300, category: 'digital', condition: '九成新', images: [], campus: '校内面交', seller: { ...owner, id: 'someone_else' }, createdAt: '2026-01-02T00:00:00.000Z', status: 'selling' }
  ]
  storage.set('campusmarket.products.v2', products)
  const modules = {
    '../data/mock': { demoUser: owner, mockProducts: [] },
    '../config/campus': { campusConfig: { campusName: '校内', schoolName: '天津师范大学', defaultTradeLocation: '校内面交' }, normalizeLegacyLocation: value => value || '校内面交' },
    './auth': { getSession: () => ({ user: owner }) },
    './mode': { getDataMode: () => 'mock' },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) },
    './upload': { removeMockImage: async () => undefined },
    './api': {}, './cloudbase': {}
  }
  const moduleLike = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`)
    return modules[name]
  }, moduleLike, moduleLike.exports)
  const service = moduleLike.exports
  assert.deepEqual((await service.getMyProducts()).map(item => item.id), ['own'])
  assert.equal((await service.getProduct('own')).viewerIsSeller, true)
  assert.equal((await service.getProduct('other')).viewerIsSeller, false)
  assert.deepEqual((await service.getProducts()).map(item => item.id), ['other', 'own'])
  await assert.rejects(service.setProductStatus('other', 'offline'), /无权/)
  await service.setProductStatus('own', 'offline')
  assert.deepEqual((await service.getProducts()).map(item => item.id), ['other'])
  await service.setProductStatus('own', 'selling')
  assert.equal((await service.getProducts()).some(item => item.id === 'own'), true)
  service.setOrderProductStatus('own', 'selling', 'reserved')
  assert.equal((await service.getProducts()).find(item => item.id === 'own').status, 'reserved')
  await assert.rejects(service.updateProduct('own', { title: '不能编辑' }), /交易中/)
  await assert.rejects(service.deleteProduct('own'), /交易中/)
  service.setOrderProductStatus('own', 'reserved', 'selling')
  const edited = await service.updateProduct('own', { title: '新版教材', description: '完整无缺页，校内面交', price: 18, category: 'books', condition: '九成新', images: [], campus: '校内面交' })
  assert.equal(edited.title, '新版教材')
  assert.equal(storage.get('campusmarket.products.v2').find(item => item.id === 'own').price, 18)
  await service.setProductStatus('own', 'sold')
  assert.equal((await service.getProducts()).some(item => item.id === 'own'), false)
  await assert.rejects(service.setProductStatus('own', 'selling'), /状态/)
  await assert.rejects(service.updateProduct('own', { title: '不能编辑' }), /已售/)
  await service.deleteProduct('own')
  assert.equal((await service.getMyProducts()).length, 0)
  assert.equal(storage.get('campusmarket.products.v2').length, 1)
  storage.set('campusmarket.products.v2', [
    { ...products[0], id: 'legacy-active', status: 'active' },
    { ...products[0], id: 'legacy-empty', status: undefined }
  ])
  assert.deepEqual((await service.getProducts()).map(item => item.status), ['selling', 'selling'])
})
