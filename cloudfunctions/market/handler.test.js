const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('云函数拒绝非卖家编辑、下架和删除商品', async () => {
  const product = { _id: 'prod_1', sellerId: 'real_owner', title: '单车', images: [], status: 'selling' }
  let mutations = 0
  const fakeDb = {
    command: {},
    async runTransaction(callback) { return callback({ collection: name => fakeDb.collection(name) }) },
    collection(name) {
      return {
        where(query) { return { limit() { return { async get() { return { data: name === 'products' && query._id === product._id ? [product] : [] } } } } } },
        doc() { return { async get() { return { data: name === 'products' ? product : null } }, async update() { mutations++ }, async remove() { mutations++ } } }
      }
    }
  }
  const fakeCloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database() { return fakeDb },
    getWXContext() { return { OPENID: 'attacker' } }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return fakeCloud
    if (request === 'sharp') return () => { throw new Error('sharp should not run') }
    return originalLoad.call(this, request, parent, isMain)
  }
  let main
  try { ({ main } = require('./index')) }
  finally { Module._load = originalLoad }

  for (const action of ['updateProduct', 'setProductStatus', 'deleteProduct']) {
    const result = await main({ action, id: product._id, status: 'offline', product: {} })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'FORBIDDEN')
  }
  assert.equal(mutations, 0)
})
