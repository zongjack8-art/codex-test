const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTS(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const moduleLike = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`)
    return dependencies[name]
  }, moduleLike, moduleLike.exports)
  return moduleLike.exports
}

test('Mock 买家订单可创建、持久化、阻止重复；取消后保留历史', async () => {
  const storage = new Map()
  const product = { id: 'p1', title: '闲置教材', price: 22, status: 'selling', images: ['cover.jpg'], seller: { id: 'seller', nickname: '小卖', avatar: '卖' } }
  const service = loadTS('services/orders.ts', {
    '../data/mock': { demoUser: { id: 'demo-me' } },
    './api': {}, './auth': {}, './cloudbase': {}, './mode': { getDataMode: () => 'mock' },
    './products': { getProduct: async () => product, setProductStatus: async status => { product.status = status } },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) }
  })
  const created = await service.createOrder('p1')
  assert.equal(created.amount, 22)
  assert.equal(created.status, 'pending')
  assert.equal((await service.listOrders('buyer')).length, 1)
  assert.equal((await service.listOrders('seller')).length, 0)
  await assert.rejects(service.createOrder('p1'), /进行中的订单/)
  await assert.rejects(service.changeOrder(created.id, 'confirmOrder'), /只有卖家/)
  assert.equal((await service.changeOrder(created.id, 'cancelOrder')).status, 'cancelled')
  const next = await service.createOrder('p1')
  assert.notEqual(next.id, created.id)
  assert.equal((await service.listOrders('buyer')).length, 2)
  assert.equal((await service.getOrder(created.id)).status, 'cancelled')
})

test('订单页面只给当前身份与状态允许的操作', () => {
  const { orderActions } = loadTS('utils/orders.ts')
  assert.deepEqual(orderActions({ role: 'seller', status: 'pending' }), ['confirmOrder', 'cancelOrder'])
  assert.deepEqual(orderActions({ role: 'buyer', status: 'pending' }), ['cancelOrder'])
  assert.deepEqual(orderActions({ role: 'seller', status: 'confirmed' }), ['completeOrder', 'cancelOrder'])
  assert.deepEqual(orderActions({ role: 'buyer', status: 'confirmed' }), ['cancelOrder'])
  assert.deepEqual(orderActions({ role: 'seller', status: 'completed' }), [])
})

test('Mock 未读按买卖角色持久化，旧订单缺失字段不会显示红点', async () => {
  const storage = new Map()
  const demoUser = { id: 'buyer' }
  const product = { id: 'p1', title: '闲置教材', price: 22, status: 'selling', images: [], seller: { id: 'seller', nickname: '小卖', avatar: '卖' } }
  const service = loadTS('services/orders.ts', {
    '../data/mock': { demoUser },
    './api': {}, './auth': {}, './cloudbase': {}, './mode': { getDataMode: () => 'mock' },
    './products': { getProduct: async () => product, setProductStatus: async (_id, status) => { product.status = status } },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) }
  })
  const created = await service.createOrder('p1')
  assert.equal(created.unread, false)
  assert.deepEqual(await service.getOrderUnreadSummary(), { buyer: 0, seller: 0, total: 0 })
  demoUser.id = 'seller'
  assert.equal((await service.listOrders('seller'))[0].unread, true)
  assert.deepEqual(await service.getOrderUnreadSummary(), { buyer: 0, seller: 1, total: 1 })
  assert.deepEqual(await service.markOrdersRead('buyer'), { cleared: 0 })
  assert.equal((await service.getOrderUnreadSummary()).seller, 1)
  assert.deepEqual(await service.markOrdersRead('seller'), { cleared: 1 })
  assert.equal((await service.getOrderUnreadSummary()).total, 0)
  await service.changeOrder(created.id, 'confirmOrder')
  demoUser.id = 'buyer'
  assert.equal((await service.getOrder(created.id)).unread, true)
  assert.deepEqual(await service.markOrdersRead('seller'), { cleared: 0 })
  assert.equal((await service.getOrderUnreadSummary()).buyer, 1)
  assert.deepEqual(await service.markOrdersRead('buyer'), { cleared: 1 })
  demoUser.id = 'seller'
  await service.changeOrder(created.id, 'completeOrder')
  demoUser.id = 'buyer'
  assert.equal((await service.getOrderUnreadSummary()).buyer, 1)
  const raw = storage.get('campusmarket.orders.v1')
  raw.push({ ...raw[0], id: 'old', buyerUnread: undefined, sellerUnread: undefined })
  assert.equal((await service.listOrders('buyer')).find(order => order.id === 'old').unread, false)
})

test('Mock 取消订单时只提醒另一方', async () => {
  const storage = new Map()
  const demoUser = { id: 'buyer' }
  const product = { id: 'p1', title: '闲置教材', price: 22, status: 'selling', images: [], seller: { id: 'seller', nickname: '小卖', avatar: '卖' } }
  const service = loadTS('services/orders.ts', {
    '../data/mock': { demoUser },
    './api': {}, './auth': {}, './cloudbase': {}, './mode': { getDataMode: () => 'mock' },
    './products': { getProduct: async () => product, setProductStatus: async () => {} },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) }
  })
  const first = await service.createOrder('p1')
  await service.changeOrder(first.id, 'cancelOrder')
  demoUser.id = 'seller'
  assert.equal((await service.getOrderUnreadSummary()).seller, 1)
  await service.markOrdersRead('seller')
  demoUser.id = 'buyer'
  const second = await service.createOrder('p1')
  demoUser.id = 'seller'
  await service.changeOrder(second.id, 'cancelOrder')
  demoUser.id = 'buyer'
  assert.equal((await service.getOrderUnreadSummary()).buyer, 1)
  assert.equal((await service.getOrder(second.id)).unread, true)
})
