const campus = require('./campus.json')
const { cleanText, fail, safeId, validateReport } = require('./security')

const moderationActions = ['createReport', 'getAdminStatus', 'getAdminNotificationSummary',
  'adminListProducts', 'adminTakeDownProduct', 'adminListReports', 'adminResolveReport']

async function presentReports(store, rows, own) {
  const products = await store.productCards(rows.map(row => row.product_id))
  const byId = new Map(products.map(row => [row.id, row]))
  const sellers = own ? null : await store.people(products.map(row => row.seller_id))
  return rows.map(row => {
    const product = byId.get(row.product_id)
    return {
      id: row.id, productId: row.product_id, reason: row.reason, description: row.description || '',
      createdAt: Number(row.created_at), status: row.status, productTitle: product?.title || '商品已删除',
      productImage: product?.images?.[0] || '',
      ...(own ? { resolution: row.resolution, resolvedAt: Number(row.resolved_at) || null }
        : { reporterId: row.reporter_id, sellerNickname: sellers.get(product?.seller_id)?.nickname || '校园同学' })
    }
  })
}

async function pgModeration(store, event, caller, actorId) {
  const { action } = event
  const school = campus.schoolName
  if (action === 'createReport') {
    const report = validateReport(event.report)
    const item = await store.product(report.productId)
    if (!item || item.school !== school) fail('NOT_FOUND', '商品不存在')
    if (item.seller_id === actorId) fail('INVALID_INPUT', '不能举报自己的商品')
    const reporterId = actorId || (await store.login(caller)).id
    const created = await store.rpc('create_report', { p_actor_id: reporterId, p_product_id: report.productId,
      p_school: school, p_reason: report.reason, p_description: report.description })
    return { created }
  }

  const identity = { p_app_id: caller.appId, p_open_id: caller.openId }
  const isAdmin = (await store.rpc('admin_identity', identity)) != null
  const args = { ...identity, p_school: school }
  if (action === 'getAdminStatus') {
    if (event.includeMyReports !== true) return { isAdmin }
    return { isAdmin, myReports: actorId ? await presentReports(store,
      await store.rpc('reports', { ...args, p_actor_id: actorId }), true) : [] }
  }
  if (!isAdmin) fail('FORBIDDEN', '没有管理员权限')
  switch (action) {
    case 'getAdminNotificationSummary':
      return { pendingReports: Number(await store.rpc('pending_report_count', args)) }
    case 'adminListReports': return presentReports(store, await store.rpc('reports', { ...args, p_actor_id: null }), false)
    case 'adminListProducts': {
      const products = await store.adminProducts()
      const sellers = await store.people(products.map(row => row.seller_id))
      return products.map(row => ({
        id: row.id, title: row.title || '未命名商品', image: row.images?.[0] || '', price: Number(row.price),
        status: row.status, createdAt: Number(row.created_at) || 0, sellerId: row.seller_id,
        sellerNickname: sellers.get(row.seller_id)?.nickname || '校园同学',
        sellerAvatar: sellers.get(row.seller_id)?.avatar || '同', moderationStatus: row.moderation_status
      }))
    }
    case 'adminTakeDownProduct':
      await store.rpc('take_down_product', { ...args, p_product_id: safeId(event.id), p_reason: cleanText(event.reason, '下架理由', 2, 200) })
      return { takenDown: true }
    case 'adminResolveReport': {
      const id = safeId(event.id)
      if (event.resolution !== 'takedown' && event.resolution !== 'dismiss') fail('INVALID_INPUT', '举报处理方式无效')
      await store.rpc('resolve_report', { ...args, p_report_id: id, p_resolution: event.resolution })
      return { resolved: true }
    }
  }
}

module.exports = { moderationActions, pgModeration }
