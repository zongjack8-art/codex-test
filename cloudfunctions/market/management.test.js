const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const campus = require('./campus.json')

function marketFixture() {
  const image = 'cloud://test.bucket/images/owner/12345678abcd.jpg'
  const foreignImage = 'cloud://test.bucket/images/other_user/99999999abcd.jpg'
  const rows = {
    users: [{ _id: 'owner', nickname: '卖家', avatar: '同', campus: campus.campusName, school: campus.schoolName }],
    products: [
      { _id: 'p1', sellerId: 'owner', school: campus.schoolName, title: '九成新单车', description: '骑行正常，方便校内面交', price: 199, category: 'sports', condition: '九成新', images: [image, foreignImage], location: '校内面交', status: 'selling', createdAt: 10 },
      { _id: 'legacy', sellerId: 'owner', title: '旧版商品', description: '旧版测试商品', price: 20, category: 'books', condition: '八成新', images: [], createdAt: 1 },
      { _id: 'other', sellerId: 'other_user', school: campus.schoolName, title: '别人的书', status: 'active', createdAt: 2 }
    ],
    favorites: [{ _id: 'fav1', productId: 'p1', userId: 'other_user' }],
    reports: [],
    conversations: [{ _id: 'conv1', productId: 'p1', buyerId: 'other_user', sellerId: 'owner', productSnapshot: { title: '九成新单车' } }],
    messages: [{ _id: 'msg1', conversationId: 'conv1', senderId: 'other_user', content: '还在吗' }]
  }
  const deletedFiles = []
  let openid = 'owner'
  const command = { in: values => ({ in: values }), neq: value => ({ neq: value }) }
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key])
    if (value && typeof value === 'object' && 'neq' in value) return row[key] !== value.neq
    return row[key] === value
  })
  const db = { command, async runTransaction(callback) { return callback({ collection: name => db.collection(name) }) }, collection(name) {
    return {
      where(query) {
        let offset = 0; let limit = Infinity; let sort = null
        const cursor = {
          skip(value) { offset = value; return cursor },
          limit(value) { limit = value; return cursor },
          orderBy(field, direction) { sort = [field, direction]; return cursor },
          async get() {
            const selected = rows[name].filter(row => matches(row, query))
            if (sort) selected.sort((a, b) => sort[1] === 'desc' ? (b[sort[0]] || 0) - (a[sort[0]] || 0) : (a[sort[0]] || 0) - (b[sort[0]] || 0))
            return { data: selected.slice(offset, offset + limit) }
          },
          async count() { return { total: rows[name].filter(row => matches(row, query)).length } },
          async remove() { rows[name] = rows[name].filter(row => !matches(row, query)) }
        }
        return cursor
      },
      doc(id) { return {
        async get() { return { data: rows[name].find(row => row._id === id) || null } },
        async update({ data }) { Object.assign(rows[name].find(row => row._id === id), data) },
        async remove() { rows[name] = rows[name].filter(row => row._id !== id) }
      } }
    }
  } }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return db },
    getWXContext() { return { OPENID: openid } },
    async downloadFile() { return { fileContent: Buffer.from('test') } },
    async deleteFile({ fileList }) { deletedFiles.push(...fileList); return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) } }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    if (request === 'sharp') return () => { throw new Error('sharp should not run') }
    return originalLoad.call(this, request, parent, isMain)
  }
  let main
  try {
    delete require.cache[require.resolve('./index')]
    ;({ main } = require('./index'))
  } finally { Module._load = originalLoad }
  return { main, rows, image, deletedFiles, setUser(value) { openid = value } }
}

test('我的发布仅按真实 OPENID 查询，旧商品缺字段仍可管理', async () => {
  const fx = marketFixture()
  const result = await fx.main({ action: 'getMyProducts', sellerId: 'other_user' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.map(item => item._id), ['p1', 'legacy'])
  assert.equal((await fx.main({ action: 'getProduct', id: 'legacy' })).data._id, 'legacy')
  fx.setUser('other_user')
  assert.deepEqual((await fx.main({ action: 'getMyProducts' })).data.map(item => item._id), ['other'])
})

test('编辑、下架、重新上架、售出只影响卖家商品和公共在售列表', async () => {
  const fx = marketFixture()
  const input = { title: '单车和车锁', description: '骑行正常，附车锁，可校内面交', price: 180, category: 'sports', condition: '九成新', images: [fx.image], location: '校内面交', sellerId: 'attacker', school: '其他学校', status: 'sold' }
  const edited = await fx.main({ action: 'updateProduct', id: 'p1', product: input })
  assert.equal(edited.ok, true)
  assert.equal(fx.rows.products[0].title, '单车和车锁')
  assert.equal(fx.rows.products[0].sellerId, 'owner')
  assert.equal(fx.rows.products[0].school, campus.schoolName)
  assert.equal(fx.rows.products[0].status, 'selling')
  assert.deepEqual(fx.deletedFiles, [], 'editing a legacy record must not delete another user image')
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'p1'), true)
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'other'), true, '旧版 active 商品按在售进入公共列表')
  assert.equal((await fx.main({ action: 'setProductStatus', id: 'p1', status: 'offline' })).ok, true)
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'p1'), false)
  assert.equal((await fx.main({ action: 'setProductStatus', id: 'p1', status: 'selling' })).ok, true)
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'p1'), true)
  assert.equal((await fx.main({ action: 'setProductStatus', id: 'p1', status: 'sold' })).ok, true)
  assert.equal((await fx.main({ action: 'listProducts' })).data.some(item => item._id === 'p1'), false)
  assert.equal((await fx.main({ action: 'getMyProducts' })).data.find(item => item._id === 'p1').status, 'sold')
  assert.equal((await fx.main({ action: 'setProductStatus', id: 'p1', status: 'selling' })).error.code, 'INVALID_STATE')
  assert.equal((await fx.main({ action: 'updateProduct', id: 'p1', product: input })).error.code, 'INVALID_STATE')
})

test('其他人不能编辑、改状态或删除；删除保留聊天历史', async () => {
  const fx = marketFixture()
  fx.setUser('attacker')
  for (const action of ['updateProduct', 'setProductStatus', 'deleteProduct']) {
    const result = await fx.main({ action, id: 'p1', status: 'offline', product: {} })
    assert.equal(result.error.code, 'FORBIDDEN')
  }
  assert.equal(fx.rows.products.some(item => item._id === 'p1'), true)
  fx.setUser('owner')
  assert.equal((await fx.main({ action: 'deleteProduct', id: 'p1' })).ok, true)
  assert.equal(fx.rows.products.some(item => item._id === 'p1'), false)
  assert.equal(fx.rows.favorites.length, 0)
  assert.equal(fx.rows.conversations.length, 1)
  assert.equal(fx.rows.messages.length, 1)
  assert.deepEqual(fx.deletedFiles, [fx.image])
})
