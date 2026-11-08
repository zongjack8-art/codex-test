const campus = require('./campus.json')
const { cleanText, fail, safeId } = require('./security')

const reviewActions = ['createReview', 'getOrderReview', 'getSellerReviewSummary', 'listSellerReviews']
const present = row => ({ rating: row.rating, content: row.content || '', createdAt: Number(row.created_at) })

async function pgReview(store, event, actorId) {
  if (event.action === 'getSellerReviewSummary' || event.action === 'listSellerReviews') {
    const sellerId = safeId(event.sellerId)
    if (event.action === 'getSellerReviewSummary') {
      return store.rpc('seller_review_summary', { p_seller_id: sellerId, p_school: campus.schoolName })
    }
    return (await store.sellerReviews(sellerId)).map(present)
  }

  const orderId = safeId(event.orderId)
  if (event.action === 'createReview') {
    if (!Number.isInteger(event.rating) || event.rating < 1 || event.rating > 5) fail('INVALID_INPUT', '请选择 1 至 5 星评分')
    const content = cleanText(event.content ?? '', '补充说明', 0, 200)
    await store.rpc('create_review', {
      p_actor_id: actorId ?? null, p_order_id: orderId, p_rating: event.rating, p_content: content, p_school: campus.schoolName
    })
    return { created: true }
  }

  const order = await store.order(orderId)
  if (!order) fail('NOT_FOUND', '订单不存在')
  if (order.buyer_id !== actorId && order.seller_id !== actorId) fail('FORBIDDEN', '无权查看此订单')
  const review = await store.orderReview(orderId)
  return review ? { reviewed: true, review: present(review) } : { reviewed: false }
}

module.exports = { reviewActions, pgReview }
