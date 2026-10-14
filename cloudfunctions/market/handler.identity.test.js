const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const campus = require('./campus.json')

test('云函数忽略客户端伪造的用户、商品和举报归属', async () => {
  const rows = Object.fromEntries(['users', 'products', 'favorites', 'reports'].map(name => [name, new Map()]))
  let openid = 'real_user'
  let nextId = 0
  const matchValue = (actual, expected) => {
    if (expected && typeof expected === 'object' && expected.operator === 'in') return expected.values.includes(actual)
    if (expected && typeof expected === 'object' && expected.operator === 'gte') return actual >= expected.value
    return actual === expected
  }
  const fakeDb = {
    command: {
      in: values => ({ operator: 'in', values }),
      gte: value => ({ operator: 'gte', value })
    },
    collection(name) {
      const data = rows[name]
      return {
        where(query) {
          const matched = () => [...data.values()].filter(row => Object.entries(query).every(([key, value]) => matchValue(row[key], value)))
          return {
            limit() { return this },
            async get() { return { data: matched() } },
            async count() { return { total: matched().length } }
          }
        },
        async add({ data: input }) {
          const _id = input._id || `generated_${++nextId}`
          if (data.has(_id)) throw new Error('duplicate id')
          data.set(_id, { ...input, _id })
          return { _id }
        },
        doc(id) {
          return {
            async update({ data: changes }) { data.set(id, { ...data.get(id), ...changes }) },
            async remove() { data.delete(id) }
          }
        }
      }
    }
  }
  const fakeCloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database() { return fakeDb },
    getWXContext() { return { OPENID: openid } },
    async downloadFile() { return { fileContent: Buffer.from('image bytes') } }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return fakeCloud
    if (request === 'sharp') return () => { throw new Error('sharp should not run') }
    return originalLoad.call(this, request, parent, isMain)
  }
  let main
  try {
    delete require.cache[require.resolve('./index')]
    ;({ main } = require('./index'))
  } finally { Module._load = originalLoad }

  const profile = await main({ action: 'updateProfile', profile: { nickname: '天师大同学', avatar: '同', campus: '校内', school: '其他学校', userId: 'attacker' } })
  assert.equal(profile.ok, true)
  assert.equal(rows.users.get('real_user').school, campus.schoolName)
  assert.equal(rows.users.has('attacker'), false)

  const image = 'cloud://example.bucket/images/real_user/12345678abcd.jpg'
  const created = await main({ action: 'createProduct', product: {
    title: '闲置教材', description: '书页完整，校内面交', price: 18,
    category: 'books', condition: '九成新', images: [image], location: '校内面交',
    sellerId: 'attacker', school: '其他学校', status: 'sold'
  } })
  assert.equal(created.ok, true)
  const product = [...rows.products.values()][0]
  assert.equal(product.sellerId, 'real_user')
  assert.equal(product.school, campus.schoolName)
  assert.equal(product.status, 'selling')
  const ownerDetail = await main({ action: 'getProduct', id: product._id, openid: 'forged_buyer', userId: 'forged_buyer' })
  assert.equal(ownerDetail.ok, true)
  assert.equal(ownerDetail.data.viewerIsSeller, true, '归属只按当前微信 OPENID 和数据库 sellerId 计算')

  const favorite = await main({ action: 'setFavorite', id: product._id, favorited: true, userId: 'attacker' })
  assert.equal(favorite.ok, true)
  assert.equal([...rows.favorites.values()][0].userId, 'real_user')
  await main({ action: 'setFavorite', id: product._id, favorited: true, userId: 'attacker' })
  assert.equal(rows.favorites.size, 1)

  openid = 'buyer_user'
  const buyerDetail = await main({ action: 'getProduct', id: product._id, sellerId: 'buyer_user', openid: 'real_user' })
  assert.equal(buyerDetail.ok, true)
  assert.equal(buyerDetail.data.viewerIsSeller, false)
  product.status = 'sold'
  assert.equal((await main({ action: 'setFavorite', id: product._id, favorited: true })).error.code, 'NOT_FOUND')
  product.status = 'offline'
  assert.equal((await main({ action: 'setFavorite', id: product._id, favorited: true })).error.code, 'NOT_FOUND')
  assert.equal((await main({ action: 'getProduct', id: product._id })).data.status, 'offline', '旧链接可查看下架状态')
  product.status = 'active'
  assert.equal((await main({ action: 'setFavorite', id: product._id, favorited: true })).ok, true)
  product.status = undefined
  assert.equal((await main({ action: 'getProduct', id: product._id })).ok, true)
  assert.equal((await main({ action: 'setFavorite', id: product._id, favorited: true })).ok, true)
  openid = 'real_user'

  rows.products.set('other_product', { ...product, _id: 'other_product', sellerId: 'another_user' })
  assert.equal((await main({ action: 'createReport', report: { productId: product._id, reason: 'other' } })).error.code, 'INVALID_INPUT', '卖家不可举报自己')
  assert.equal((await main({ action: 'createReport', report: { productId: 'missing', reason: 'fraud' } })).error.code, 'NOT_FOUND')
  const beforeReport = JSON.stringify(rows.products.get('other_product'))
  const report = await main({ action: 'createReport', report: { productId: 'other_product', reason: 'misleading', description: '图片不实', reporterId: 'attacker' } })
  assert.equal(report.ok, true)
  assert.equal([...rows.reports.values()][0].reporterId, 'real_user')
  assert.equal([...rows.reports.values()][0].reason, 'misleading')
  assert.equal([...rows.reports.values()][0].status, 'pending')
  assert.deepEqual((await main({ action: 'createReport', report: { productId: 'other_product', reason: 'fraud' } })).data, { created: false })
  assert.equal(rows.reports.size, 1)
  assert.equal(JSON.stringify(rows.products.get('other_product')), beforeReport, '举报不得修改商品')
})
