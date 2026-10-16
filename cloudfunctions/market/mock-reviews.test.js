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

test('Mock 已完成订单可评价一次，本地持久化并展示卖家信用；身份和输入仍受限制', async () => {
  const storage = new Map()
  const demoUser = { id: 'buyer' }
  const order = { id: 'order1', productId: 'product1', buyerId: 'buyer', sellerId: 'seller', role: 'buyer', status: 'completed' }
  const service = loadTS('services/reviews.ts', {
    '../config/campus': { campusConfig: { schoolName: '天津师范大学' } },
    '../data/mock': { demoUser }, './api': {}, './auth': {}, './cloudbase': {},
    './mode': { getDataMode: () => 'mock' },
    './orders': { getOrder: async id => {
      if (id !== order.id || !['buyer', 'seller'].includes(demoUser.id)) throw new Error('无权查看')
      return { ...order, role: demoUser.id === 'buyer' ? 'buyer' : 'seller' }
    } },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) }
  })
  assert.deepEqual(await service.getOrderReview('order1'), { reviewed: false })
  await assert.rejects(service.createReview('order1', 0, ''), /评分/)
  await assert.rejects(service.createReview('order1', 6, ''), /评分/)
  await assert.rejects(service.createReview('order1', 1.5, ''), /评分/)
  await assert.rejects(service.createReview('order1', 5, '评'.repeat(201)), /200/)
  order.status = 'confirmed'
  await assert.rejects(service.createReview('order1', 5, ''), /完成交易/)
  order.status = 'completed'
  assert.deepEqual(await service.createReview('order1', 4, ' 方便面交 '), { created: true })
  await assert.rejects(service.createReview('order1', 5, '重复'), /已经评价/)
  const state = await service.getOrderReview('order1')
  assert.equal(state.reviewed, true)
  assert.deepEqual(Object.keys(state.review).sort(), ['content', 'createdAt', 'rating'])
  assert.equal(state.review.content, '方便面交')
  assert.deepEqual(await service.getSellerReviewSummary('seller'), { averageRating: 4, reviewCount: 1 })
  assert.equal((await service.listSellerReviews('seller'))[0].rating, 4)
  demoUser.id = 'seller'
  assert.equal((await service.getOrderReview('order1')).reviewed, true)
  await assert.rejects(service.createReview('order1', 5, ''), /买家/)
  demoUser.id = 'stranger'
  await assert.rejects(service.getOrderReview('order1'), /无权查看/)
  assert.deepEqual(await service.getSellerReviewSummary('nobody'), { averageRating: 0, reviewCount: 0 })
})
