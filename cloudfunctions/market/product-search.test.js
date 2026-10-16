const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const campus = require('./campus.json')

const listings = [
  { _id: 'book', sellerId: 'seller', school: campus.schoolName, title: '高等数学教材', description: '书页整洁', price: 20, category: 'books', status: 'selling', createdAt: 10 },
  { _id: 'lamp', sellerId: 'seller', school: campus.schoolName, title: '小台灯', description: '毕业季宿舍清仓', price: 49, category: 'daily', status: 'reserved', createdAt: 20 },
  { _id: 'headphones', sellerId: 'seller', school: campus.schoolName, title: '蓝牙耳机', description: '正常使用', price: 320, category: 'digital', status: 'selling', createdAt: 30 },
  { _id: 'legacy', sellerId: 'seller', school: campus.schoolName, title: '旧版相机', description: '可试机', price: 99, category: 'digital', status: 'active', createdAt: 15 },
  { _id: 'sold', sellerId: 'seller', school: campus.schoolName, title: '已售教材', description: '毕业季', price: 10, category: 'books', status: 'sold', createdAt: 50 },
  { _id: 'removed', sellerId: 'seller', school: campus.schoolName, title: '已下架教材', description: '毕业季', price: 15, category: 'books', status: 'removed', createdAt: 60 },
  { _id: 'foreign', sellerId: 'seller', school: '其他学校', title: '外校教材', description: '毕业季', price: 12, category: 'books', status: 'selling', createdAt: 70 },
  { _id: 'blocked', sellerId: 'seller', school: campus.schoolName, title: '违规教材', description: '毕业季', price: 15, category: 'books', status: 'selling', moderationStatus: 'blocked', createdAt: 80 }
]

function cloudFixture() {
  const expression = (op, value) => ({ op, value, and(other) { return { op: 'and', value: [this, other] } } })
  const command = {
    in: values => expression('in', values),
    gte: value => expression('gte', value),
    lt: value => expression('lt', value),
    or: values => expression('or', values)
  }
  const matchesValue = (actual, expected) => {
    if (expected instanceof RegExp) return expected.test(actual || '')
    if (!expected || typeof expected !== 'object' || !expected.op) return actual === expected
    if (expected.op === 'in') return expected.value.includes(actual)
    if (expected.op === 'gte') return actual >= expected.value
    if (expected.op === 'lt') return actual < expected.value
    if (expected.op === 'and') return expected.value.every(part => matchesValue(actual, part))
    if (expected.op === 'or') return expected.value.some(part => matchesRow(actual, part))
    throw new Error(`Unknown query operator ${expected.op}`)
  }
  const matchesRow = (row, query) => query.op === 'or'
    ? query.value.some(part => matchesRow(row, part))
    : Object.entries(query).every(([field, expected]) => matchesValue(row[field], expected))
  const db = {
    command,
    RegExp: ({ regexp, options }) => new RegExp(regexp, options),
    collection(name) {
      return {
        where(query) {
          let order = null; let count = 100
          const cursor = {
            orderBy(field, direction) { order = [field, direction]; return cursor },
            limit(value) { count = value; return cursor },
            async get() {
              const rows = name === 'products' ? listings : [{ _id: 'seller', nickname: '校园同学', avatar: '同', campus: '校内' }]
              const result = rows.filter(row => matchesRow(row, query))
              if (order) result.sort((a, b) => (order[1] === 'desc' ? -1 : 1) * (a[order[0]] - b[order[0]]))
              return { data: result.slice(0, count) }
            }
          }
          return cursor
        }
      }
    }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return db } }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve('./index')]
    return require('./index').main
  } finally { Module._load = originalLoad }
}

function mockFixture() {
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/products.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const user = { id: 'demo', nickname: '校园同学', school: campus.schoolName, campus: '校内', avatar: '同' }
  const products = listings.map(item => ({
    id: item._id, title: item.title, description: item.description, price: item.price,
    category: item.category, status: item.status, school: item.school, createdAt: new Date(item.createdAt).toISOString(),
    seller: { ...user, id: item.sellerId }, images: [], campus: '校内', condition: '九成新', moderationStatus: item.moderationStatus
  }))
  const modules = {
    '../data/mock': { demoUser: user, mockProducts: [] },
    '../config/campus': { campusConfig: { schoolName: campus.schoolName, campusName: '校内', defaultTradeLocation: '校内' }, normalizeLegacyLocation: value => value || '校内' },
    './auth': { getSession: () => ({ user }) },
    './mode': { getDataMode: () => 'mock' },
    './storage': { readLocal: key => key === 'campusmarket.products.v2' ? products : [] },
    './upload': {}, './api': {}, './cloudbase': {}
  }
  const moduleLike = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => modules[name], moduleLike, moduleLike.exports)
  return moduleLike.exports.getProducts
}

test('Cloud / Mock 搜索、分类、价格边界、排序、状态与学校隔离一致', async () => {
  const main = cloudFixture()
  const getMock = mockFixture()
  const cases = [
    [{}, ['headphones', 'lamp', 'legacy', 'book']],
    [{ keyword: '  数学  ' }, ['book']],
    [{ keyword: ' 毕业季 ' }, ['lamp']],
    [{ keyword: '   ' }, ['headphones', 'lamp', 'legacy', 'book']],
    [{ category: 'books' }, ['book']],
    [{ category: 'all' }, ['headphones', 'lamp', 'legacy', 'book']],
    [{ minPrice: 0, maxPrice: 20 }, []],
    [{ minPrice: 20, maxPrice: 50 }, ['lamp', 'book']],
    [{ minPrice: 50, maxPrice: 100 }, ['legacy']],
    [{ minPrice: 100, maxPrice: 300 }, []],
    [{ minPrice: 300 }, ['headphones']],
    [{ sort: 'priceAsc' }, ['book', 'lamp', 'legacy', 'headphones']],
    [{ sort: 'priceDesc' }, ['headphones', 'legacy', 'lamp', 'book']],
    [{ category: 'digital', minPrice: 300, sort: 'priceAsc' }, ['headphones']],
    [{ school: '其他学校' }, ['headphones', 'lamp', 'legacy', 'book']]
  ]
  for (const [filters, expected] of cases) {
    const cloudResult = await main({ action: 'listProducts', filters })
    assert.equal(cloudResult.ok, true, JSON.stringify(filters))
    assert.deepEqual(cloudResult.data.map(item => item._id), expected, `Cloud: ${JSON.stringify(filters)}`)
    assert.deepEqual((await getMock(filters)).map(item => item.id), expected, `Mock: ${JSON.stringify(filters)}`)
    assert.equal(cloudResult.data.every(item => !('sellerId' in item) && item.seller.id === ''), true, 'seller OPENID must stay private')
  }
  assert.equal((await main({ action: 'listProducts', filters: { minPrice: 50, maxPrice: 20 } })).error.code, 'INVALID_INPUT')
})
