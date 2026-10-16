const { createHash } = require('node:crypto')
const campus = require('./campus.json')
const { fail, safeId, cleanText } = require('./security')

const reviewId = orderId => createHash('sha256').update(`review:${orderId}`).digest('hex').slice(0, 24)
const present = row => ({ rating: row.rating, content: row.content || '', createdAt: row.createdAt })

function createReviewHandler({ db, orders }) {
  // Lazily access the new collection so existing actions remain independent of deployment setup.
  const reviews = () => db.collection('reviews')
  async function currentOrder(orderId, openid) {
    const order = (await orders.where({ _id: orderId }).limit(1).get()).data[0]
    if (!order || (order.school && order.school !== campus.schoolName)) fail('NOT_FOUND', '订单不存在')
    if (order.buyerId !== openid && order.sellerId !== openid) fail('FORBIDDEN', '无权查看此订单')
    return order
  }
  function assertReviewable(order, openid) {
    if (order.buyerId !== openid || order.sellerId === openid) fail('FORBIDDEN', '只有订单买家可以评价卖家')
    if (order.status !== 'completed') fail('INVALID_STATE', '完成交易后才可以评价')
    safeId(order.sellerId); safeId(order.productId)
  }
  async function existing(orderId) {
    return (await reviews().where({ orderId }).limit(1).get()).data[0] || null
  }
  async function sellerRows(sellerId, visit) {
    for (let offset = 0; ; offset += 100) {
      const rows = (await reviews().where({ sellerId }).orderBy('createdAt', 'desc').skip(offset).limit(100).get()).data
      for (const row of rows) {
        if (row.school === campus.schoolName && await visit(row) === false) return
      }
      if (rows.length < 100) return
    }
  }
  return async function reviewAction(action, event, openid) {
    if (action === 'createReview') {
      const orderId = safeId(event.orderId)
      if (!Number.isInteger(event.rating) || event.rating < 1 || event.rating > 5) fail('INVALID_INPUT', '请选择 1 至 5 星评分')
      const content = cleanText(event.content == null ? '' : event.content, '补充说明', 0, 200)
      assertReviewable(await currentOrder(orderId, openid), openid)
      if (await existing(orderId)) fail('ALREADY_REVIEWED', '这笔订单已经评价过了')
      try {
        await db.runTransaction(async tx => {
          const order = (await tx.collection('orders').doc(orderId).get()).data
          if (!order || (order.school && order.school !== campus.schoolName)) fail('NOT_FOUND', '订单不存在')
          assertReviewable(order, openid)
          // add (never set) with a deterministic ID also rejects concurrent duplicate submissions.
          await tx.collection('reviews').add({ data: {
            _id: reviewId(orderId), orderId, productId: order.productId,
            buyerId: openid, sellerId: order.sellerId, rating: event.rating,
            content, createdAt: Date.now(), school: campus.schoolName
          } })
        })
      } catch (error) {
        if (await existing(orderId)) fail('ALREADY_REVIEWED', '这笔订单已经评价过了')
        throw error
      }
      return { created: true }
    }
    if (action === 'getOrderReview') {
      const orderId = safeId(event.orderId)
      await currentOrder(orderId, openid)
      const review = await existing(orderId)
      return review && review.school === campus.schoolName ? { reviewed: true, review: present(review) } : { reviewed: false }
    }
    if (action === 'getSellerReviewSummary') {
      const sellerId = safeId(event.sellerId)
      let total = 0, reviewCount = 0
      await sellerRows(sellerId, row => { total += row.rating; reviewCount++ })
      return { averageRating: reviewCount ? Math.round(total / reviewCount * 10) / 10 : 0, reviewCount }
    }
    if (action === 'listSellerReviews') {
      const sellerId = safeId(event.sellerId)
      const result = []
      await sellerRows(sellerId, row => { result.push(present(row)); return result.length < 20 })
      return result
    }
    fail('INVALID_ACTION', '不支持的评价操作')
  }
}
module.exports = { createReviewHandler, reviewId }
