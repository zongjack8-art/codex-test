const cloud = require('wx-server-sdk')

const { randomUUID } = require('node:crypto')
const campus = require('./campus.json')
const { createChatHandler } = require('./chat')
const { createOrderHandler } = require('./orders')
const { createAdminHandler } = require('./admin')
const {
  AppError, CATEGORIES, MAX_IMAGE_BYTES, fail, cleanText, safeId,
  ownImage, incomingImage, validateProduct, validateProfile, validateReport, favoriteId, assertOwner, productStatus, assertStatusTransition, escapeRegExp
} = require('./security')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const users = db.collection('users')
const products = db.collection('products')
const favorites = db.collection('favorites')
const reports = db.collection('reports')
const conversations = db.collection('conversations')
const messages = db.collection('messages')
const orders = db.collection('orders')
const admins = db.collection('admins')
const chatActions = new Set(['startConversation', 'listConversations', 'getConversation', 'listMessages', 'sendMessage', 'markConversationRead', 'getUnreadMessageCount'])
const orderActions = new Set(['createOrder', 'listOrders', 'getOrder', 'confirmOrder', 'completeOrder', 'cancelOrder', 'getOrderUnreadSummary', 'markOrdersRead'])
const adminActions = new Set(['getAdminStatus', 'getAdminNotificationSummary', 'adminListProducts', 'adminTakeDownProduct', 'adminListReports', 'adminResolveReport'])

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
  return { id: user._id, nickname: user.nickname, avatar: user.avatar, school: campus.schoolName, campus: user.campus, bio: user.bio || '' }
}
async function ensureUser(openid) {
  let user = await one(users, openid)
  if (user) {
    const legacyCampus = /(?:北区|[东西南北])校区/u.test(user.campus || '')
    const legacyAvatar = user.avatar === '🎓'
    if (user.school !== campus.schoolName || legacyCampus || legacyAvatar) {
      const changes = { school: campus.schoolName, ...(legacyCampus ? { campus: campus.campusName } : {}), ...(legacyAvatar ? { avatar: '同' } : {}), updatedAt: Date.now() }
      await users.doc(openid).update({ data: changes })
      user = { ...user, ...changes }
    }
    return user
  }
  const now = Date.now()
  try {
    await users.add({ data: { _id: openid, nickname: '校园同学', avatar: '同', school: campus.schoolName, campus: campus.campusName, bio: '', createdAt: now, updatedAt: now } })
  } catch (error) {
    // A concurrent first login may have inserted the same deterministic _id.
    user = await one(users, openid)
    if (!user) throw error
  }
  return user || await one(users, openid)
}
const chat = createChatHandler({ db, users, products, conversations, messages, ensureUser })
const orderAction = createOrderHandler({ db, users, products, orders, ensureUser })
const adminAction = createAdminHandler({ db, admins, products, reports, users })
async function hydrate(items) {
  if (!items.length) return []
  const ids = [...new Set(items.map(item => item.sellerId))]
  const result = await users.where({ _id: _.in(ids) }).limit(ids.length).get()
  const sellers = new Map(result.data.map(user => [user._id, publicUser(user)]))
  return items.map(item => ({ ...item, seller: sellers.get(item.sellerId) || { id: item.sellerId, nickname: '校园同学', avatar: '同', school: campus.schoolName, campus: campus.campusName } }))
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
    await reports.add({ data: { type: 'image_cleanup', status: 'pending', school: campus.schoolName, productId, fileIDs, reason: String(error.message || error).slice(0, 200), createdAt: Date.now(), updatedAt: Date.now() } })
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
  // Legacy records may contain external or another user's image IDs.
  // Never delete a file outside this seller's verified product directory.
  const safeFileIDs = fileIDs.filter(fileID => ownImage(fileID, openid, 'product'))
  if (!safeFileIDs.length) return
  const owned = products.where({ sellerId: openid })
  const count = await owned.count()
  if (count.total > 100) {
    await recordCleanupFailure(safeFileIDs, productId, new Error('商品数量超过安全清理查询上限'))
    return
  }
  const remaining = (await products.where({ sellerId: openid }).limit(100).get()).data
  const referenced = new Set(remaining.flatMap(item => item.images || []))
  await cleanFiles(safeFileIDs.filter(fileID => !referenced.has(fileID)), productId)
}

async function run(action, event) {
  if (action === 'listProducts') {
    const filters = event.filters || {}
    const category = filters.category && filters.category !== 'all' ? filters.category : undefined
    if (category && !CATEGORIES.has(category)) fail('INVALID_INPUT', '商品分类无效')
    const keyword = filters.keyword ? cleanText(filters.keyword, '关键词', 1, 40) : ''
    const base = { status: _.in(['selling', 'active']), school: campus.schoolName, ...(category ? { category } : {}) }
    const regex = keyword ? db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' }) : null
    const condition = regex ? _.or([{ ...base, title: regex }, { ...base, description: regex }]) : base
    const sort = filters.sort === 'priceAsc' ? ['price', 'asc'] : filters.sort === 'priceDesc' ? ['price', 'desc'] : ['createdAt', 'desc']
    const result = await products.where(condition).orderBy(sort[0], sort[1]).limit(50).get()
    return hydrate(result.data.filter(item => item.moderationStatus !== 'blocked'))
  }
  if (action === 'getProduct') {
    const openid = identity()
    const item = await one(products, safeId(event.id))
    if (!item || (item.school && item.school !== campus.schoolName)) return null
    return { ...(await hydrate([item]))[0], viewerIsSeller: item.sellerId === openid }
  }

  const openid = identity()
  if (chatActions.has(action)) return chat(action, event, openid)
  if (orderActions.has(action)) return orderAction(action, event, openid)
  if (adminActions.has(action)) return adminAction(action, event, openid)
  if (action === 'login') return publicUser(await ensureUser(openid))
  if (action === 'updateProfile') {
    await ensureUser(openid)
    const profile = validateProfile(event.profile, openid)
    if (profile.avatar !== '同') await verifyStoredImages([profile.avatar])
    const old = await one(users, openid)
    await users.doc(openid).update({ data: { ...profile, updatedAt: Date.now() } })
    if (old.avatar !== profile.avatar && ownImage(old.avatar, openid, 'avatar')) await cleanFiles([old.avatar], `avatar:${openid}`)
    return publicUser(await one(users, openid))
  }
  if (action === 'finalizeImage') {
    const purpose = event.purpose === 'avatar' ? 'avatar' : 'product'
  
    if (!incomingImage(event.fileID, openid)) {
      fail('INVALID_IMAGE', '上传路径不属于当前用户')
    }
  
    try {
      const result = await cloud.downloadFile({ fileID: event.fileID })
      const data = result.fileContent
  
      if (!data || data.length > MAX_IMAGE_BYTES) {
        fail('INVALID_IMAGE', '图片不得超过 5 MB')
      }
  
      let extension = ''
  
      // JPEG
      if (
        data.length >= 3 &&
        data[0] === 0xff &&
        data[1] === 0xd8 &&
        data[2] === 0xff
      ) {
        extension = 'jpg'
      }
  
      // PNG
      else if (
        data.length >= 8 &&
        data[0] === 0x89 &&
        data[1] === 0x50 &&
        data[2] === 0x4e &&
        data[3] === 0x47 &&
        data[4] === 0x0d &&
        data[5] === 0x0a &&
        data[6] === 0x1a &&
        data[7] === 0x0a
      ) {
        extension = 'png'
      }
  
      // WebP
      else if (
        data.length >= 12 &&
        data.toString('ascii', 0, 4) === 'RIFF' &&
        data.toString('ascii', 8, 12) === 'WEBP'
      ) {
        extension = 'webp'
      }
  
      if (!extension) {
        fail('INVALID_IMAGE', '只支持 JPEG、PNG 或 WebP 图片')
      }
  
      const folder = purpose === 'avatar' ? 'avatars' : 'images'
  
      const saved = await cloud.uploadFile({
        cloudPath: `${folder}/${openid}/${randomUUID().replace(/-/g, '')}.${extension}`,
        fileContent: data
      })
  
      return { fileID: saved.fileID }
    } finally {
      try {
        await cloud.deleteFile({ fileList: [event.fileID] })
      } catch (error) {
        console.error('Could not delete incoming image', error)
      }
    }
  }
  if (action === 'discardImages') {
    const fileIDs = event.fileIDs
    const purpose = event.purpose === 'avatar' ? 'avatar' : 'product'
    if (!Array.isArray(fileIDs) || fileIDs.length < 1 || fileIDs.length > 3 || !fileIDs.every(fileID => ownImage(fileID, openid, purpose))) {
      fail('INVALID_IMAGE', '待清理图片无效')
    }
    if (purpose === 'product') await cleanProductFiles(fileIDs, openid, 'discarded_upload')
    else {
      const user = await one(users, openid)
      await cleanFiles(fileIDs.filter(fileID => fileID !== user?.avatar), `avatar:${openid}`)
    }
    return { discarded: true }
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
    // Only the trusted OPENID selects products. Avoid filtering on newer fields
    // so older listings remain manageable without clearing the collection.
    const items = []
    for (let offset = 0; ; offset += 100) {
      const batch = (await products.where({ sellerId: openid }).skip(offset).limit(100).get()).data
      items.push(...batch)
      if (batch.length < 100) break
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return hydrate(items)
  }
  if (action === 'updateProduct') {
    const old = await ownedProduct(event.id, openid)
    if (productStatus(old.status) === 'sold') fail('INVALID_STATE', '已售商品不能再编辑')
    const data = validateProduct(event.product, openid)
    await verifyStoredImages(data.images)
    await products.doc(old._id).update({ data: { ...data, updatedAt: Date.now() } })
    await cleanProductFiles((old.images || []).filter(fileID => !data.images.includes(fileID)), openid, old._id)
    return (await hydrate([await one(products, old._id)]))[0]
  }
  if (action === 'setProductStatus') {
    const id = safeId(event.id)
    await db.runTransaction(async tx => {
      const old = (await tx.collection('products').doc(id).get()).data
      if (!old) fail('NOT_FOUND', '商品不存在')
      assertOwner(old, openid)
      if (old.moderationStatus === 'blocked' && event.status === 'selling') fail('FORBIDDEN', '管理员下架的商品不能自行重新上架')
      assertStatusTransition(old.status, event.status)
      await tx.collection('products').doc(id).update({ data: { status: event.status, updatedAt: Date.now() } })
    })
    return { status: event.status }
  }
  if (action === 'deleteProduct') {
    const old = await ownedProduct(event.id, openid)
    await products.doc(old._id).remove()
    await favorites.where({ productId: old._id }).remove()
    await cleanProductFiles((old.images || []).filter(fileID => ownImage(fileID, openid, 'product')), openid, old._id)
    return { deleted: true }
  }
  if (action === 'getFavoriteIds' || action === 'getFavorites') {
    const rows = (await favorites.where({ userId: openid }).orderBy('createdAt', 'desc').limit(500).get()).data
    const ids = rows.map(item => item.productId)
    if (action === 'getFavoriteIds') return ids
    if (!ids.length) return []
    const items = (await products.where({ _id: _.in(ids.slice(0, 50)), school: campus.schoolName, status: _.neq('offline') }).limit(50).get()).data.filter(item => item.moderationStatus !== 'blocked')
    const ordered = ids.map(id => items.find(item => item._id === id)).filter(Boolean)
    return hydrate(ordered)
  }
  if (action === 'setFavorite') {
    const id = safeId(event.id)
    if (typeof event.favorited !== 'boolean') fail('INVALID_INPUT', '收藏状态无效')
    const key = favoriteId(openid, id)
    if (event.favorited) {
      const item = await one(products, id)
      if (!item || (item.school && item.school !== campus.schoolName) || item.moderationStatus === 'blocked' || productStatus(item.status) !== 'selling') fail('NOT_FOUND', '商品未在售')
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
  if (action === 'createReport') {
    const report = validateReport(event.report)
    const item = await one(products, report.productId)
    if (!item || (item.school && item.school !== campus.schoolName)) fail('NOT_FOUND', '商品不存在')
    if (item.sellerId === openid) fail('INVALID_INPUT', '不能举报自己的商品')
    const duplicate = await reports.where({ type: 'product', reporterId: openid, productId: report.productId, status: 'pending' }).limit(1).get()
    if (duplicate.data.length) return { created: false }
    const recent = await reports.where({ type: 'product', reporterId: openid, createdAt: _.gte(Date.now() - 86400000) }).count()
    if (recent.total >= 10) fail('RATE_LIMITED', '今日举报次数已达上限')
    const now = Date.now()
    await reports.add({ data: { type: 'product', reporterId: openid, ...report, school: campus.schoolName, status: 'pending', createdAt: now, updatedAt: now } })
    return { created: true }
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
