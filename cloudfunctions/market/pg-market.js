const campus = require('./campus.json')
const { createPgStore, publicUser } = require('./pg-store')
const { orderActions, pgOrder } = require('./pg-orders')
const { chatActions, pgChat } = require('./pg-chat')
const { reviewActions, pgReview } = require('./pg-reviews')
const { moderationActions, pgModeration } = require('./pg-moderation')
const { finalizeImage } = require('./pg-images')
const {
  AppError, fail, safeId, validateProfile, validateProduct, productFilters, STATUSES,
  ownImage, imageExtension, MAX_IMAGE_BYTES
} = require('./security')

const appIdPattern = /^wx[0-9a-f]{16}$/
const actions = new Set([
  'login', 'updateProfile', 'listProducts', 'getProduct', 'getMyProducts', 'createProduct',
  'updateProduct', 'setProductStatus', 'deleteProduct', 'getFavoriteIds', 'getFavorites', 'setFavorite',
  'recordProductView', 'listRecentViews', 'clearRecentViews', 'finalizeImage', 'discardImages',
  ...orderActions, ...chatActions, ...reviewActions, ...moderationActions
])

function trustedCaller(context, allowedApps) {
  const { APPID: appId, OPENID: openId, FROM_APPID: fromAppId, FROM_OPENID: fromOpenId } = context || {}
  if (typeof appId !== 'string' || !appIdPattern.test(appId) || typeof openId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(openId)) {
    fail('UNAUTHENTICATED', '请在微信小程序中登录后重试')
  }
  if (!allowedApps.has(appId) || (fromAppId && fromAppId !== appId) || (fromOpenId && fromOpenId !== openId)) {
    fail('FORBIDDEN', '当前小程序无权访问')
  }
  return { appId, openId }
}

function createPgMarket({ cloud, getDatabase, appIds, storagePrefix = '', getCallerContext = () => cloud.getWXContext() }) {
  const allowedApps = new Set(appIds.filter(appId => appIdPattern.test(appId)))
  const prefix = /^cloud:\/\/[a-z0-9._-]+\/$/i.test(storagePrefix) ? storagePrefix : ''
  let store

  const inStorage = fileID => !!prefix && typeof fileID === 'string' && fileID.startsWith(prefix)
  const ownFile = (fileID, id, purpose) => inStorage(fileID) && ownImage(fileID, id, purpose)

  async function verifyImages(fileIDs) {
    for (const fileID of fileIDs) {
      const { fileContent } = await cloud.downloadFile({ fileID })
      if (!Buffer.isBuffer(fileContent) || !fileContent.length || fileContent.length > MAX_IMAGE_BYTES) {
        fail('INVALID_IMAGE', '商品图片不存在或过大')
      }
      imageExtension(fileContent)
    }
  }

  async function changeProduct(action, event, caller, actorId) {
    const creating = action === 'createProduct'
    const id = creating ? null : safeId(event.id)
    const existing = creating ? null : await store.product(id)
    if (!creating && !existing) fail('NOT_FOUND', '商品不存在')
    if (!creating && existing.seller_id !== actorId) fail('FORBIDDEN', '只能操作自己发布的商品')

    const args = { p_actor_id: actorId ?? null, p_school: campus.schoolName, p_id: id, p_storage_prefix: prefix }
    if (action === 'setProductStatus') {
      if (!STATUSES.has(event.status)) fail('INVALID_INPUT', '商品状态无效')
      await store.rpc('write_product', { ...args, p_operation: 'status', p_status: event.status })
      return { status: event.status }
    }
    if (action === 'deleteProduct') {
      await store.rpc('write_product', { ...args, p_operation: 'delete' })
      return { deleted: true }
    }
    if (existing && ['sold', 'reserved'].includes(existing.status)) fail('INVALID_STATE', '已售或交易中的商品不能编辑')
    const owner = creating ? (await store.login(caller)).id : actorId
    const previous = existing?.images ?? []
    const data = validateProduct(event.product, owner, fileID => previous.includes(fileID) || ownFile(fileID, owner, 'product'))
    await verifyImages(data.images.filter(fileID => !previous.includes(fileID)))
    const row = await store.rpc('write_product', {
      ...args, p_actor_id: owner, p_operation: creating ? 'create' : 'update', p_product: data, p_previous_images: previous
    })
    return (await store.render([row]))[0]
  }

  async function run(event, caller) {
    const { action } = event
    if (!actions.has(action)) fail('INVALID_ACTION', '不支持的操作')
    store ??= createPgStore(getDatabase())
    if (action === 'listProducts') return store.listProducts(productFilters(event.filters || {}))
    if (action === 'login') return publicUser(await store.login(caller))
    if (action === 'updateProfile') {
      const current = await store.login(caller)
      const profile = validateProfile(event.profile, current.id,
        fileID => fileID === current.avatar || ownFile(fileID, current.id, 'avatar'))
      if (profile.avatar !== '同' && profile.avatar !== current.avatar) await verifyImages([profile.avatar])
      return publicUser(await store.rpc('update_profile', {
        p_actor_id: current.id, p_profile: profile, p_previous_avatar: current.avatar, p_storage_prefix: prefix
      }))
    }

    if (action === 'createProduct') return changeProduct(action, event, caller)
    const actorId = await store.actor(caller)
    if (orderActions.includes(action)) return pgOrder(store, event, caller, actorId)
    if (chatActions.includes(action)) return pgChat(store, event, caller, actorId)
    if (reviewActions.includes(action)) return pgReview(store, event, actorId)
    if (moderationActions.includes(action)) return pgModeration(store, event, caller, actorId)
    switch (action) {
      case 'getProduct': {
        const item = await store.product(safeId(event.id))
        if (!item || item.school !== campus.schoolName) return null
        return { ...(await store.render([item]))[0], viewerIsSeller: item.seller_id === actorId }
      }
      case 'getMyProducts': return actorId ? store.myProducts(actorId) : []
      case 'updateProduct':
      case 'setProductStatus':
      case 'deleteProduct': return changeProduct(action, event, caller, actorId)
      case 'getFavoriteIds': return actorId ? store.favoriteIds(actorId) : []
      case 'getFavorites': return actorId ? store.favorites(await store.favoriteIds(actorId)) : []
      case 'setFavorite': {
        const id = safeId(event.id)
        if (typeof event.favorited !== 'boolean') fail('INVALID_INPUT', '收藏状态无效')
        const owner = actorId || (event.favorited ? (await store.login(caller)).id : null)
        if (owner) await store.rpc('favorite', { p_actor_id: owner, p_product_id: id, p_school: campus.schoolName, p_favorited: event.favorited })
        return { favorited: event.favorited }
      }
      case 'recordProductView': {
        const id = safeId(event.productId)
        const owner = actorId || (await store.login(caller)).id
        await store.rpc('record_view', { p_actor_id: owner, p_product_id: id, p_school: campus.schoolName })
        return { recorded: true }
      }
      case 'listRecentViews': return actorId ? store.recentViews(actorId) : []
      case 'clearRecentViews': {
        if (actorId) await store.rpc('clear_views', { p_actor_id: actorId, p_school: campus.schoolName })
        return { cleared: true }
      }
      case 'finalizeImage': return finalizeImage(cloud, store, event, actorId, prefix)
      case 'discardImages': {
        const { fileIDs } = event
        const purpose = event.purpose === 'avatar' ? 'avatar' : 'product'
        if (!actorId || !Array.isArray(fileIDs) || fileIDs.length < 1 || fileIDs.length > 3 || !fileIDs.every(id => ownFile(id, actorId, purpose))) {
          fail('INVALID_IMAGE', '待清理图片无效')
        }
        await store.rpc('queue_cleanup', {
          p_actor_id: actorId, p_school: campus.schoolName, p_storage_prefix: prefix,
          p_kind: purpose === 'avatar' ? 'avatar' : 'discarded_upload', p_files: fileIDs
        })
        return { discarded: true }
      }
    }
  }

  return async (event, context) => {
    try {
      const caller = trustedCaller(getCallerContext(context), allowedApps)
      return { ok: true, data: await run(event || {}, caller) }
    } catch (error) {
      if (error instanceof AppError) return { ok: false, error: { code: error.code, message: error.message } }
      console.error('market pg request failed')
      return { ok: false, error: { code: 'SERVER_ERROR', message: '云服务暂时不可用，请稍后再试' } }
    }
  }
}

function createRuntime() {
  const cloud = require('wx-server-sdk')
  const cloudbase = require('@cloudbase/js-sdk')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  let database
  return createPgMarket({
    cloud,
    getCallerContext(context) {
      try {
        const { environment, environ } = cloudbase.parseContext(context)
        const wx = environment || environ
        return { APPID: wx?.WX_APPID, OPENID: wx?.WX_OPENID,
          FROM_APPID: wx?.WX_FROM_APPID ?? wx?.FROM_APPID, FROM_OPENID: wx?.WX_FROM_OPENID ?? wx?.FROM_OPENID }
      } catch { return undefined }
    },
    getDatabase() {
      if (!database) {
        database = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV, timeout: 8000 }).rdb()
      }
      return database
    },
    appIds: (process.env.REHUB_MARKET_PG_APP_IDS || '').split(',').map(value => value.trim()),
    storagePrefix: process.env.REHUB_MARKET_PG_STORAGE_PREFIX
  })
}

module.exports = { createPgMarket, createRuntime }
