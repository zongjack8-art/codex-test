const { createHash } = require('node:crypto')
const campus = require('./campus.json')

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const CATEGORIES = new Set(['books', 'digital', 'daily', 'sports', 'fashion', 'other'])
const STATUSES = new Set(['selling', 'sold', 'offline'])
const STATUS_TRANSITIONS = { selling: new Set(['sold', 'offline']), reserved: new Set(), offline: new Set(['selling']), sold: new Set() }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const REPORT_REASONS = new Set(['prohibited', 'misleading', 'fraud', 'other'])

function fail(code, message) { throw new AppError(code, message) }
function cleanText(value, label, min, max) {
  if (typeof value !== 'string') fail('INVALID_INPUT', `${label}格式错误`)
  const text = value.trim().replace(/\r\n/g, '\n')
  const controls = label === '描述' || label === '个人简介' || label === '补充说明' ? /[\u0000-\u0008\u000b-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u
  if (text.length < min || text.length > max || controls.test(text) || /(?:https?:\/\/|www\.)/iu.test(text) || /(.)\1{9,}/u.test(text)) {
    fail('INVALID_INPUT', `${label}长度或内容不符合要求`)
  }
  return text
}
function cleanPrice(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    fail('INVALID_INPUT', `${label}必须是 0.01 至 100000 元之间的金额`)
  }
  return value
}
function safeId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) fail('INVALID_INPUT', '商品 ID 无效')
  return id
}
function cloudPath(fileID) {
  if (typeof fileID !== 'string') return ''
  const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(fileID)
  return match ? match[1] : ''
}
function ownImage(fileID, openid, purpose) {
  const folder = purpose === 'avatar' ? 'avatars' : 'images'
  const path = cloudPath(fileID)
  return path.startsWith(`${folder}/${openid}/`) && /^[a-zA-Z0-9_-]{8,80}\.(?:jpg|jpeg|png|webp)$/.test(path.slice(`${folder}/${openid}/`.length))
}
function incomingImage(fileID, openid) {
  const path = cloudPath(fileID)
  return path.startsWith(`incoming/${openid}/`) && /^[a-zA-Z0-9_-]{8,80}\.(?:jpg|jpeg|png|webp)$/.test(path.slice(`incoming/${openid}/`.length))
}
function validateImages(images, canUseImage) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 3 || new Set(images).size !== images.length) fail('INVALID_INPUT', '请上传 1 至 3 张不重复的商品图片')
  if (!images.every(canUseImage)) fail('INVALID_INPUT', '图片必须由当前用户上传并经服务端验证')
  return images
}
function validateProduct(input, openid, canUseImage = fileID => ownImage(fileID, openid, 'product')) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', '商品内容无效')
  if (!CATEGORIES.has(input.category)) fail('INVALID_INPUT', '商品分类无效')
  return {
    title: cleanText(input.title, '标题', 2, 60),
    description: cleanText(input.description, '描述', 5, 1000),
    price: cleanPrice(input.price, '价格'),
    originalPrice: cleanPrice(input.originalPrice, '原价', true) ?? null,
    category: input.category,
    condition: cleanText(input.condition, '新旧程度', 2, 20),
    images: validateImages(input.images, canUseImage),
    location: cleanText(input.location, '交易地点', 2, 80),
    school: campus.schoolName
  }
}
function validateProfile(input, openid, canUseAvatar = fileID => ownImage(fileID, openid, 'avatar')) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', '资料内容无效')
  const avatar = input.avatar === '🎓' ? '同' : input.avatar || '同'
  if (avatar !== '同' && !canUseAvatar(avatar)) fail('INVALID_INPUT', '头像必须由当前用户上传')
  return {
    nickname: cleanText(input.nickname, '昵称', 2, 32),
    school: campus.schoolName,
    campus: cleanText(input.campus, '校内范围', 2, 60),
    avatar,
    bio: input.bio == null ? '' : cleanText(input.bio, '个人简介', 0, 160)
  }
}
function validateReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', '举报内容无效')
  if (!REPORT_REASONS.has(input.reason)) fail('INVALID_INPUT', '举报原因无效')
  return {
    productId: safeId(input.productId),
    reason: input.reason,
    description: input.description == null ? '' : cleanText(input.description, '补充说明', 0, 500)
  }
}

function productFilters(filters = {}) {
  const category = filters.category && filters.category !== 'all' ? filters.category : undefined
  if (category && !CATEGORIES.has(category)) fail('INVALID_INPUT', '商品分类无效')
  const keyword = filters.keyword == null || filters.keyword === '' ? '' : cleanText(filters.keyword, '关键词', 0, 40)
  const bound = (value, label) => {
    if (value == null) return undefined
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) fail('INVALID_INPUT', `${label}无效`)
    return value
  }
  const minPrice = bound(filters.minPrice, '最低价格')
  const maxPrice = bound(filters.maxPrice, '最高价格')
  if (minPrice !== undefined && maxPrice !== undefined && minPrice >= maxPrice) fail('INVALID_INPUT', '价格区间无效')
  const sort = ['priceAsc', 'priceDesc'].includes(filters.sort) ? filters.sort : 'latest'
  return { category, keyword, minPrice, maxPrice, sort }
}

function imageExtension(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (data.length >= png.length && png.every((byte, index) => data[index] === byte)) return 'png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  fail('INVALID_IMAGE', '只支持 JPEG、PNG 或 WebP 图片')
}
function favoriteId(openid, productId) {
  return createHash('sha256').update(`${openid}:${productId}`).digest('hex')
}
function escapeRegExp(text) {
  return [...text].map(char => '\\^$.*+?()[]{}|'.includes(char) ? `\\${char}` : char).join('')
}
function assertOwner(product, openid) {
  if (!product || product.sellerId !== openid) fail('FORBIDDEN', '只能操作自己发布的商品')
}

// Earlier products may have no status or use the old active/removed names.
function productStatus(value) { return value === 'active' || !value ? 'selling' : value === 'removed' ? 'offline' : value }
function assertStatusTransition(current, next) {
  if (!STATUSES.has(next)) fail('INVALID_INPUT', '商品状态无效')
  if (!STATUS_TRANSITIONS[productStatus(current)]?.has(next)) fail('INVALID_STATE', '当前商品状态不支持此操作')
}

module.exports = { AppError, CATEGORIES, STATUSES, REPORT_REASONS, MAX_IMAGE_BYTES, fail, cleanText, safeId, cloudPath, ownImage, incomingImage, validateProduct, validateProfile, validateReport, productFilters, imageExtension, favoriteId, assertOwner, productStatus, assertStatusTransition, escapeRegExp }
