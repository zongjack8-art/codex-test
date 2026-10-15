const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../../src/utils/routeId.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const routeModule = { exports: {} }
new Function('module', 'exports', code)(routeModule, routeModule.exports)
const { retainRouteId } = routeModule.exports

test('详情页首次取得商品 ID，返回时空路由参数不能覆盖它', async () => {
  const productId = { current: '' }
  const requested = []
  const getProduct = async id => { requested.push(id); return { id, status: 'selling' } }
  assert.equal(retainRouteId(productId, 'product-1'), 'product-1')
  assert.equal((await getProduct(retainRouteId(productId, undefined))).id, 'product-1')
  assert.equal((await getProduct(retainRouteId(productId, ''))).id, 'product-1')
  assert.deepEqual(requested, ['product-1', 'product-1'])
})

test('首次缺失 ID 时不请求商品；真实商品已删除时仍返回 null', async () => {
  const productId = { current: '' }
  const requested = []
  const getProduct = async id => { requested.push(id); return null }
  assert.equal(retainRouteId(productId, ''), '')
  if (productId.current) await getProduct(productId.current)
  assert.deepEqual(requested, [])
  assert.equal(await getProduct(retainRouteId(productId, 'deleted-product')), null)
  assert.deepEqual(requested, ['deleted-product'])
})

test('聊天与订单页面返回时保留各自首次有效 ID，不接受子页面的 ID', () => {
  const conversationId = { current: '' }
  const orderId = { current: '' }
  assert.equal(retainRouteId(conversationId, 'conversation-1'), 'conversation-1')
  assert.equal(retainRouteId(orderId, 'order-1'), 'order-1')
  assert.equal(retainRouteId(conversationId, null), 'conversation-1')
  assert.equal(retainRouteId(orderId, '   '), 'order-1')
  assert.equal(retainRouteId(conversationId, 'child-product-id'), 'conversation-1')
})
