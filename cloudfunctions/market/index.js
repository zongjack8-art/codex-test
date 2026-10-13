const cloud = require('wx-server-sdk')
const sharp = require('sharp')
const { randomUUID } = require('node:crypto')
const {
  AppError, CATEGORIES, STATUSES, MAX_IMAGE_BYTES, fail, cleanText, safeId,
  ownImage, incomingImage, validateProduct, validateProfile, favoriteId, assertOwner, escapeRegExp
} = require('./security')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const users = db.collection('users')
const products = db.collection('products')
const favorites = db.collection('favorites')
const reports = db.collection('reports')

function identity() {
  const openid = cloud.getWXContext().OPENID
  if (!openid) fail('UNAUTHENTICATED', '请在微信小程序中登录后重试')
  return openid
}
async function one(collection, id) {
  const result = await collection.where({ _id: id }).limit(1).get()
  return result.data[0] || null
}
function publicUser(user) {
  return { id: user._id, nickname: user.nickname, avatar: user.avatar, school: user.school, campus: user.campus }
}
async function ensureUser(openid) {
  let user = await one(users, openid)
  if (user) return user
  const now = Date.now()
  try {
    await users.add({ data: { _id: openid, nickname: '校园同学', avatar: '🎓', school: '待完善', campus: '待完善', createdAt: now, updatedAt: now } })
  } catch (error) {
    // A concurrent first login may have inserted the same deterministic _id.
    user = await one(users, openid)
    if (!user) throw error
  }
  return user || await one(users, openid)
}
async function hydrate(items) {
  if (!items.length) return []
  const ids = [...new Set(items.map(item => item.sellerId))]
  const result = await users.where({ _id: _.in(ids) }).limit(ids.length).get()
  const sellers = new Map(result.data.map(user => [user._id, publicUser(user)]))
  return items.map(item => ({ ...item, seller: sellers.get(item.sellerId) || { id: item.sellerId, nickname: '校园同学', avatar: '🎓', campus: item.location } }))
}
async function ownedProduct(id, openid) {
  const product = await one(products, safeId(id))
  if (!product) fail('NOT_FOUND', '商品不存在')
  assertOwner(product, openid)
  return product
}
async function verifyStoredImages(fileIDs) {
  for (const fileID of fileIDs) {
    const result = await cloud.downloadFile({ fileID })
    const buffer = result.fileContent
    if (!buffer || buffer.length > MAX_IMAGE_BYTES) fail('INVALID_IMAGE', '商品图片不存在或过大')
  }
}
async function recordCleanupFailure(fileIDs, productId, error) {
  try {
    await reports.add({ data: { type: 'image_cleanup', status: 'pending', productId, fileIDs, reason: String(error.message || error).slice(0, 200), createdAt: Date.now() } })
  } catch (recordError) { console.error('Could not record cleanup failure', recordError) }
}
async function cleanFiles(fileIDs, productId) {
  if (!fileIDs.length) return
  try {
    const result = await cloud.deleteFile({ fileList: fileIDs })
    const failed = (result?.fileList || []).filter(item => item.status !== 0)
    if (failed.length) await recordCleanupFailure(failed.map(item => item.fileID), productId, new Error('云存储返回删除失败'))
  }
  catch (error) { await recordCleanupFailure(fileIDs, productId, error) }
}
async function cleanProductFiles(fileIDs, openid, productId) {
  if (!fileIDs.length) return
  const owned = products.where({ sellerId: openid })
  const count = await owned.count()
  if (count.total > 100) {
    await recordCleanupFailure(fileIDs, productId, new Error('商品数量超过安全清理查询上限'))
    return
  }
  const remaining = (await products.where({ sellerId: openid }).limit(100).get()).data
  const referenced = new Set(remaining.flatMap(item => item.images || []))
  await cleanFiles(fileIDs.filter(fileID => !referenced.has(fileID)), productId)
}

async function run(action, event) {
  if (action === 'listProducts') {
    const filters = event.filters || {}
    const category = filters.category && filters.category !== 'all' ? filters.category : undefined
    if (category && !CATEGORIES.has(category)) fail('INVALID_INPUT', '商品分类无效')
    const keyword = filters.keyword ? cleanText(filters.keyword, '关键词', 1, 40) : ''
    const base = { status: 'selling', ...(category ? { category } : {}) }
    const regex = keyword ? db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' }) : null
    const condition = regex ? _.or([{ ...base, title: regex }, { ...base, description: regex }]) : base
    const sort = filters.sort === 'priceAsc' ? ['price', 'asc'] : filters.sort === 'priceDesc' ? ['price', 'desc'] : ['createdAt', 'desc']
    const result = await products.where(condition).orderBy(sort[0], sort[1]).limit(50).get()
    return hydrate(result.data)
  }
  if (action === 'getProduct') {
    const item = await one(products, safeId(event.id))
    if (!item || (item.status === 'offline' && item.sellerId !== cloud.getWXContext().OPENID)) return null
    return (await hydrate([item]))[0]
  }

  const openid = identity()
  if (action === 'login') return publicUser(await ensureUser(openid))
  if (action === 'updateProfile') {
    await ensureUser(openid)
    const profile = validateProfile(event.profile, openid)
    if (profile.avatar !== '🎓') await verifyStoredImages([profile.avatar])
    const old = await one(users, openid)
    await users.doc(openid).update({ data: { ...profile, updatedAt: Date.now() } })
    if (old.avatar !== profile.avatar && ownImage(old.avatar, openid, 'avatar')) await cleanFiles([old.avatar], `avatar:${openid}`)
    return publicUser(await one(users, openid))
  }
  if (action === 'finalizeImage') {
    const purpose = event.purpose === 'avatar' ? 'avatar' : 'product'
    if (!incomingImage(event.fileID, openid)) fail('INVALID_IMAGE', '上传路径不属于当前用户')
    try {
      const result = await cloud.downloadFile({ fileID: event.fileID })
      const data = result.fileContent
      if (!data || data.length > MAX_IMAGE_BYTES) fail('INVALID_IMAGE', '图片不得超过 5 MB')
      const meta = await sharp(data, { limitInputPixels: 24000000 }).metadata()
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) !== 1 || !meta.width || !meta.height || meta.width * meta.height > 24000000) {
        fail('INVALID_IMAGE', '只支持单帧 JPEG、PNG 或 WebP 图片')
      }
      const normalized = await sharp(data).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
      const folder = purpose === 'avatar' ? 'avatars' : 'images'
      const saved = await cloud.uploadFile({ cloudPath: `${folder}/${openid}/${randomUUID().replace(/-/g, '')}.jpg`, fileContent: normalized })
      return { fileID: saved.fileID }
    } finally {
      try { await cloud.deleteFile({ fileList: [event.fileID] }) }
      catch (error) { console.error('Could not delete incoming image', error) }
    }
  }
  if (action === 'createProduct') {
    await ensureUser(openid)
    const data = validateProduct(event.product, openid)
    const recent = await products.where({ sellerId: openid, createdAt: _.gte(Date.now() - 86400000) }).count()
    if (recent.total >= 20) fail('RATE_LIMITED', '每天最多发布 20 件商品')
    await verifyStoredImages(data.images)
    const now = Date.now()
    const added = await products.add({ data: { ...data, sellerId: openid, status: 'selling', createdAt: now, updatedAt: now } })
    return (await hydrate([await one(products, added._id)]))[0]
  }
  if (action === 'getMyProducts') {
    const result = await products.where({ sellerId: openid }).orderBy('createdAt', 'desc').limit(100).get()
    return hydrate(result.data)
  }
  if (action === 'updateProduct') {
    const old = await ownedProduct(event.id, openid)
    const data = validateProduct(event.product, openid)
    await verifyStoredImages(data.images)
    await products.doc(old._id).update({ data: { ...data, updatedAt: Date.now() } })
    await cleanProductFiles(old.images.filter(fileID => !data.images.includes(fileID)), openid, old._id)
    return (await hydrate([await one(products, old._id)]))[0]
  }
  if (action === 'setProductStatus') {
    const old = await ownedProduct(event.id, openid)
    if (!STATUSES.has(event.status)) fail('INVALID_INPUT', '商品状态无效')
    await products.doc(old._id).update({ data: { status: event.status, updatedAt: Date.now() } })
    return { status: event.status }
  }
  if (action === 'deleteProduct') {
    const old = await ownedProduct(event.id, openid)
    await products.doc(old._id).remove()
    await favorites.where({ productId: old._id }).remove()
    await cleanProductFiles(old.images.filter(fileID => ownImage(fileID, openid, 'product')), openid, old._id)
    return { deleted: true }
  }
  if (action === 'getFavoriteIds' || action === 'getFavorites') {
    const rows = (await favorites.where({ userId: openid }).orderBy('createdAt', 'desc').limit(500).get()).data
    const ids = rows.map(item => item.productId)
    if (action === 'getFavoriteIds') return ids
    if (!ids.length) return []
    const items = (await products.where({ _id: _.in(ids.slice(0, 50)), status: _.neq('offline') }).limit(50).get()).data
    const ordered = ids.map(id => items.find(item => item._id === id)).filter(Boolean)
    return hydrate(ordered)
  }
  if (action === 'setFavorite') {
    const id = safeId(event.id)
    if (typeof event.favorited !== 'boolean') fail('INVALID_INPUT', '收藏状态无效')
    const key = favoriteId(openid, id)
    if (event.favorited) {
      const item = await one(products, id)
      if (!item || item.status !== 'selling') fail('NOT_FOUND', '商品未在售')
      if (!await one(favorites, key)) {
        const count = await favorites.where({ userId: openid }).count()
        if (count.total >= 500) fail('RATE_LIMITED', '收藏数量已达上限')
        try { await favorites.add({ data: { _id: key, userId: openid, productId: id, createdAt: Date.now() } }) }
        catch (error) { if (!await one(favorites, key)) throw error }
      }
    } else if (await one(favorites, key)) {
      await favorites.doc(key).remove()
    }
    return { favorited: event.favorited }
  }
  fail('INVALID_ACTION', '不支持的操作')
}

exports.main = async event => {
  try { return { ok: true, data: await run(event.action, event) } }
  catch (error) {
    if (error instanceof AppError) return { ok: false, error: { code: error.code, message: error.message } }
    console.error('market function failed', error)
    return { ok: false, error: { code: 'SERVER_ERROR', message: '云服务暂时不可用，请稍后再试' } }
  }
}
