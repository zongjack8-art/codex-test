const campus = require('./campus.json')
const { cleanText, fail, productStatus, safeId } = require('./security')

const currentSchool = row => !row.school || row.school === campus.schoolName

function createAdminHandler({ db, admins, products, reports, users }) {
  const findAdmin = async openid => (await admins.where({ openid }).limit(1).get()).data[0] || null

  async function assertAdmin(openid) {
    const admin = await findAdmin(openid)
    if (!admin || admin.enabled !== true || admin.role !== 'admin') fail('FORBIDDEN', '没有管理员权限')
  }

  async function sellersFor(rows) {
    const ids = [...new Set(rows.map(row => row.sellerId).filter(Boolean))]
    if (!ids.length) return new Map()
    const result = await users.where({ _id: db.command.in(ids) }).limit(ids.length).get()
    return new Map(result.data.map(user => [user._id, user]))
  }

  async function listOwnReports(openid) {
    const rows = (await reports.where({ reporterId: openid }).limit(100).get()).data
      .filter(row => row.type === 'product' && currentSchool(row))
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const ids = [...new Set(rows.map(row => row.productId).filter(Boolean))]
    const productRows = ids.length ? (await products.where({ _id: db.command.in(ids) }).limit(ids.length).get()).data : []
    const productMap = new Map(productRows.map(row => [row._id, row]))
    return rows.map(row => {
      const product = productMap.get(row.productId)
      return {
        id: row._id,
        productId: row.productId,
        reason: row.reason,
        description: row.description || '',
        createdAt: row.createdAt || 0,
        status: row.status || 'pending',
        resolution: row.resolution || null,
        resolvedAt: row.resolvedAt || null,
        productTitle: product?.title || '商品已删除',
        productImage: product?.images?.[0] || ''
      }
    })
  }

  // The first admin release scans at most 100 documents and sorts in memory,
  // avoiding any new compound index on the live collections.
  async function listProducts() {
    const rows = (await products.limit(100).get()).data.filter(currentSchool)
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const sellers = await sellersFor(rows)
    return rows.map(row => ({
      id: row._id, title: row.title || '未命名商品', image: row.images?.[0] || '',
      price: row.price, status: productStatus(row.status), createdAt: row.createdAt || 0,
      sellerId: row.sellerId, sellerNickname: sellers.get(row.sellerId)?.nickname || '校园同学',
      sellerAvatar: sellers.get(row.sellerId)?.avatar || '同',
      moderationStatus: row.moderationStatus === 'blocked' ? 'blocked' : null
    }))
  }

  async function listReports() {
    const rows = (await reports.where({ type: 'product' }).limit(100).get()).data.filter(currentSchool)
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const ids = [...new Set(rows.map(row => row.productId).filter(Boolean))]
    const productRows = ids.length ? (await products.where({ _id: db.command.in(ids) }).limit(ids.length).get()).data : []
    const productMap = new Map(productRows.map(row => [row._id, row]))
    const sellers = await sellersFor(productRows)
    return rows.map(row => {
      const product = productMap.get(row.productId)
      return {
        id: row._id, productId: row.productId, reason: row.reason, description: row.description || '',
        reporterId: row.reporterId, createdAt: row.createdAt || 0, status: row.status || 'pending',
        productTitle: product?.title || '商品已删除', productImage: product?.images?.[0] || '',
        sellerNickname: sellers.get(product?.sellerId)?.nickname || '校园同学'
      }
    })
  }

  return async function adminAction(action, event, openid) {
    if (action === 'getAdminStatus') {
      const admin = await findAdmin(openid)
      const result = { isAdmin: admin?.enabled === true && admin.role === 'admin' }
      if (event.includeMyReports === true) result.myReports = await listOwnReports(openid)
      return result
    }
    await assertAdmin(openid)
    if (action === 'getAdminNotificationSummary') {
      let pendingReports = 0
      let offset = 0
      while (true) {
        // Scan in batches without requiring a new compound database index.
        const rows = (await reports.where({ type: 'product' }).skip(offset).limit(100).get()).data
        pendingReports += rows.filter(row => row.status === 'pending' && currentSchool(row)).length
        if (rows.length < 100) break
        offset += rows.length
      }
      return { pendingReports }
    }
    if (action === 'adminListProducts') return listProducts()
    if (action === 'adminListReports') return listReports()
    if (action === 'adminTakeDownProduct') {
      const id = safeId(event.id)
      const reason = cleanText(event.reason, '下架理由', 2, 200)
      await db.runTransaction(async tx => {
        const product = (await tx.collection('products').doc(id).get()).data
        if (!product || !currentSchool(product)) fail('NOT_FOUND', '商品不存在')
        if (product.moderationStatus === 'blocked') fail('INVALID_STATE', '商品已由管理员下架')
        const now = Date.now()
        await tx.collection('products').doc(id).update({ data: {
          status: 'offline', moderationStatus: 'blocked', moderationReason: reason,
          moderatedAt: now, moderatedBy: openid, updatedAt: now
        } })
      })
      return { takenDown: true }
    }
    if (action === 'adminResolveReport') {
      const id = safeId(event.id)
      if (event.resolution !== 'takedown' && event.resolution !== 'dismiss') fail('INVALID_INPUT', '举报处理方式无效')
      await db.runTransaction(async tx => {
        const report = (await tx.collection('reports').doc(id).get()).data
        if (!report || report.type !== 'product' || !currentSchool(report)) fail('NOT_FOUND', '举报不存在')
        if (report.status && report.status !== 'pending') fail('INVALID_STATE', '举报已经处理')
        const now = Date.now()
        if (event.resolution === 'takedown') {
          const product = (await tx.collection('products').doc(report.productId).get()).data
          if (product && !currentSchool(product)) fail('FORBIDDEN', '不能处理其他学校的商品')
          if (product) await tx.collection('products').doc(report.productId).update({ data: {
            status: 'offline', moderationStatus: 'blocked', moderationReason: `商品举报：${report.reason}`,
            moderatedAt: now, moderatedBy: openid, updatedAt: now
          } })
        }
        await tx.collection('reports').doc(id).update({ data: {
          status: event.resolution === 'takedown' ? 'resolved' : 'dismissed',
          resolution: event.resolution, resolvedAt: now, resolvedBy: openid, updatedAt: now
        } })
      })
      return { resolved: true }
    }
    fail('INVALID_ACTION', '不支持的管理员操作')
  }
}

module.exports = { createAdminHandler }
