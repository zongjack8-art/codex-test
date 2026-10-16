const { createHash } = require('node:crypto')
const campus = require('./campus.json')
const { fail, safeId, productStatus } = require('./security')

const MAX_VIEWS = 50

// CloudBase custom document IDs must stay short; the default _id index also prevents duplicates.
function viewId(openid, productId) {
  return `rv_${createHash('sha256').update(`${openid}:${productId}`).digest('hex').slice(0, 21)}`
}

function createRecentViewsHandler({ db, products, hydrate, publicListing }) {
  const _ = db.command
  const own = openid => ({ userId: openid, school: campus.schoolName })

  async function trimOldViews(recentViews, openid) {
    // Repeat from offset 50 because deletion shifts the remaining rows forward.
    for (;;) {
      const old = (await recentViews.where(own(openid)).orderBy('viewedAt', 'desc').skip(MAX_VIEWS).limit(MAX_VIEWS).get()).data
      if (!old.length) return
      await Promise.all(old.map(row => recentViews.doc(row._id).remove()))
    }
  }

  return async (action, event, openid) => {
    const recentViews = db.collection('recentViews')
    if (action === 'recordProductView') {
      const productId = safeId(event.productId)
      const item = (await products.where({ _id: productId }).limit(1).get()).data[0]
      if (!item || (item.school && item.school !== campus.schoolName) || item.moderationStatus === 'blocked' || productStatus(item.status) === 'offline') {
        fail('NOT_FOUND', '商品暂时无法浏览')
      }
      const key = viewId(openid, productId)
      const existing = (await recentViews.where({ _id: key }).limit(1).get()).data[0]
      if (existing && (existing.userId !== openid || existing.school !== campus.schoolName || existing.productId !== productId)) fail('FORBIDDEN', '浏览记录归属异常')
      const latest = (await recentViews.where(own(openid)).orderBy('viewedAt', 'desc').limit(1).get()).data[0]
      const viewedAt = Math.max(Date.now(), Number(latest?.viewedAt || 0) + 1)
      if (existing) await recentViews.doc(key).update({ data: { viewedAt } })
      else {
        try { await recentViews.add({ data: { _id: key, userId: openid, productId, school: campus.schoolName, viewedAt } }) }
        catch (error) {
          // Another request may have created the deterministic document meanwhile.
          const raced = (await recentViews.where({ _id: key }).limit(1).get()).data[0]
          if (!raced) throw error
          if (raced.userId !== openid || raced.school !== campus.schoolName || raced.productId !== productId) fail('FORBIDDEN', '浏览记录归属异常')
          await recentViews.doc(key).update({ data: { viewedAt } })
        }
      }
      await trimOldViews(recentViews, openid)
      return { recorded: true }
    }

    if (action === 'listRecentViews') {
      const rows = (await recentViews.where(own(openid)).orderBy('viewedAt', 'desc').limit(MAX_VIEWS).get()).data
      if (!rows.length) return []
      const ids = rows.map(row => row.productId)
      const found = (await products.where({ _id: _.in(ids) }).limit(MAX_VIEWS).get()).data
      const visible = found.filter(item =>
        (!item.school || item.school === campus.schoolName) &&
        item.moderationStatus !== 'blocked' && productStatus(item.status) !== 'offline'
      )
      const byId = new Map((await hydrate(visible)).map(item => [item._id, item]))
      return rows.map(row => byId.get(row.productId)).filter(Boolean).map(publicListing)
    }

    if (action === 'clearRecentViews') {
      await recentViews.where(own(openid)).remove()
      return { cleared: true }
    }

    fail('INVALID_ACTION', '不支持的操作')
  }
}

module.exports = { createRecentViewsHandler, viewId, MAX_VIEWS }
