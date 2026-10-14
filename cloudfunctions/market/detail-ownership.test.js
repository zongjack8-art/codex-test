const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../../src/pages/detail/permissions.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleLike = { exports: {} }
new Function('module', 'exports', code)(moduleLike, moduleLike.exports)
const { detailPermissions } = moduleLike.exports

test('卖家查看自己的在售商品只获得管理入口，不能收藏、联系或举报', () => {
  assert.deepEqual(detailPermissions({ status: 'selling', viewerIsSeller: true }), {
    ownershipKnown: true, canManage: true, canFavorite: false, canContact: false, canReport: false
  })
})

test('买家查看别人的在售商品可以收藏、联系和举报', () => {
  assert.deepEqual(detailPermissions({ status: 'selling', viewerIsSeller: false }), {
    ownershipKnown: true, canManage: false, canFavorite: true, canContact: true, canReport: true
  })
})

test('已售或下架商品不可发起交易；缺少服务端归属结果时不暴露买家操作', () => {
  for (const status of ['sold', 'offline']) {
    const result = detailPermissions({ status, viewerIsSeller: false })
    assert.equal(result.canFavorite, false)
    assert.equal(result.canContact, false)
    assert.equal(result.canReport, true)
  }
  assert.deepEqual(detailPermissions({ status: 'selling' }), {
    ownershipKnown: false, canManage: false, canFavorite: false, canContact: false, canReport: false
  })
})

test('商品 Service 将云函数计算的归属结果传到详情页', async () => {
  const productSource = fs.readFileSync(path.join(__dirname, '../../src/services/products.ts'), 'utf8')
  const productCode = ts.transpileModule(productSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  let ownerFlag = true
  const remote = {
    _id: 'product_1', sellerId: 'seller_1', title: '闲置教材', description: '书页完整', price: 18,
    category: 'books', condition: '九成新', images: [], location: '校内面交', status: 'selling'
  }
  const dependencies = {
    '../data/mock': { demoUser: { id: 'mock_user' }, mockProducts: [] },
    '../config/campus': { campusConfig: { campusName: '校内', schoolName: '天津师范大学' }, normalizeLegacyLocation: value => value },
    './api': {}, './auth': {}, './storage': {}, './upload': {},
    './mode': { getDataMode: () => 'cloud' },
    './cloudbase': { cloudCall: async () => ({ ...remote, viewerIsSeller: ownerFlag }) }
  }
  const productModule = { exports: {} }
  new Function('require', 'module', 'exports', productCode)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`)
    return dependencies[name]
  }, productModule, productModule.exports)

  const sellerView = await productModule.exports.getProduct('product_1')
  assert.equal(sellerView.viewerIsSeller, true)
  assert.equal(detailPermissions(sellerView).canManage, true)
  ownerFlag = false
  const buyerView = await productModule.exports.getProduct('product_1')
  assert.equal(buyerView.viewerIsSeller, false)
  assert.equal(detailPermissions(buyerView).canContact, true)
})
