const test = require('node:test')
const assert = require('node:assert/strict')
const { validateProduct, validateProfile, validateReport, assertOwner, favoriteId, incomingImage, escapeRegExp } = require('./security')
const campus = require('./campus.json')

const openid = 'user_123'
const image = `cloud://example.bucket/images/${openid}/12345678abcd.jpg`
const product = { title: '九成新单车', description: '骑行正常，可在校内面交', price: 199.5, category: 'sports', condition: '九成新', images: [image], location: '校内面交', school: '其他学校', sellerId: 'another-user', status: 'sold' }

test('商品输入只保留白名单字段，不能伪造卖家或状态', () => {
  const cleaned = validateProduct(product, openid)
  assert.equal(cleaned.sellerId, undefined)
  assert.equal(cleaned.status, undefined)
  assert.equal(cleaned.price, 199.5)
  assert.equal(cleaned.school, campus.schoolName)
})

test('商品写操作拒绝非所有者', () => {
  assert.throws(() => assertOwner({ sellerId: 'another-user' }, openid), error => error.code === 'FORBIDDEN')
  assert.doesNotThrow(() => assertOwner({ sellerId: openid }, openid))
})

test('拒绝非法价格、过长内容和其他用户图片', () => {
  assert.throws(() => validateProduct({ ...product, price: -1 }, openid), /价格/)
  assert.throws(() => validateProduct({ ...product, price: 1.001 }, openid), /价格/)
  assert.throws(() => validateProduct({ ...product, title: 'x'.repeat(61) }, openid), /标题/)
  assert.throws(() => validateProduct({ ...product, images: [image.replace(openid, 'another')] }, openid), /图片/)
})

test('上传隔离目录必须与当前用户匹配', () => {
  assert.equal(incomingImage(`cloud://example.bucket/incoming/${openid}/12345678.jpg`, openid), true)
  assert.equal(incomingImage('cloud://example.bucket/incoming/other/12345678.jpg', openid), false)
  assert.equal(incomingImage(`cloud://example.bucket/images/${openid}/12345678.jpg`, openid), false)
})

test('昵称头像和收藏 ID 校验', () => {
  assert.throws(() => validateProfile({ nickname: '同学', school: '其他学校', campus: '校内', avatar: 'https://evil.invalid/a.png' }, openid), /头像/)
  assert.equal(validateProfile({ nickname: '同学', school: '其他学校', campus: '校内', avatar: '同' }, openid).school, campus.schoolName)
  assert.equal(favoriteId(openid, 'p1'), favoriteId(openid, 'p1'))
  assert.notEqual(favoriteId(openid, 'p1'), favoriteId('another', 'p1'))
  assert.equal(escapeRegExp('iPad (Air)+'), 'iPad \\(Air\\)\\+')
})

test('举报输入只保留允许的字段', () => {
  assert.deepEqual(validateReport({ productId: 'prod_1', reason: 'misleading', description: '图片与实物不一致', reporterId: 'forged' }), { productId: 'prod_1', reason: 'misleading', description: '图片与实物不一致' })
  assert.throws(() => validateReport({ productId: 'prod_1', reason: 'anything' }), /举报原因/)
})
