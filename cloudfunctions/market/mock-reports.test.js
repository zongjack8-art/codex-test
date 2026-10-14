const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

test('Mock 举报保留本地记录、去重，并拒绝举报自己或不存在的商品', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/reports.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const storage = new Map()
  const modules = {
    '../config/campus': { campusConfig: { schoolName: '天津师范大学' } },
    '../data/mock': { demoUser: { id: 'me' } },
    './auth': {}, './api': {}, './cloudbase': {},
    './mode': { getDataMode: () => 'mock' },
    './products': { getProduct: async id => id === 'own' ? { seller: { id: 'me' } } : id === 'other' ? { seller: { id: 'seller' } } : null },
    './storage': { readLocal: (key, fallback) => storage.get(key) ?? fallback, writeLocal: (key, value) => storage.set(key, value) }
  }
  const moduleLike = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => modules[name], moduleLike, moduleLike.exports)
  const { submitReport } = moduleLike.exports
  await assert.rejects(submitReport({ productId: 'own', reason: 'other' }), /自己/)
  await assert.rejects(submitReport({ productId: 'missing', reason: 'fraud' }), /不存在/)
  assert.deepEqual(await submitReport({ productId: 'other', reason: 'misleading', description: '图片与实物不符' }), { created: true })
  assert.deepEqual(await submitReport({ productId: 'other', reason: 'fraud' }), { created: false })
  assert.equal(storage.get('campusmarket.reports.v1').length, 1)
})
