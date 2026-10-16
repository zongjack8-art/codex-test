import { campusConfig } from '../config/campus'
import { demoUser } from '../data/mock'
import type { OrderReviewState, SellerReview, SellerReviewSummary } from '../types/market'
import { apiRequest } from './api'
import { ensureUserSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { getOrder } from './orders'
import { readLocal, writeLocal } from './storage'

type StoredReview = SellerReview & {
  orderId: string
  productId: string
  buyerId: string
  sellerId: string
  school: string
}
const REVIEWS_KEY = 'campusmarket.reviews.v1'
const mockReviews = () => readLocal<StoredReview[]>(REVIEWS_KEY, [])
const publicReview = ({ rating, content, createdAt }: StoredReview): SellerReview => ({ rating, content, createdAt })

export async function createReview(orderId: string, rating: number, content: string): Promise<{ created: true }> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('请选择 1 至 5 星评分')
  if (content.length > 200) throw new Error('评价最多 200 字')
  const mode = getDataMode()
  if (mode === 'cloud') { await ensureUserSession(); return cloudCall('createReview', { orderId, rating, content }) }
  if (mode === 'api') return apiRequest(`/me/orders/${encodeURIComponent(orderId)}/review`, 'POST', { rating, content })
  const order = await getOrder(orderId)
  if (order.role !== 'buyer' || order.buyerId !== demoUser.id || order.sellerId === demoUser.id) throw new Error('只有订单买家可以评价卖家')
  if (order.status !== 'completed') throw new Error('完成交易后才可以评价')
  if (mockReviews().some(item => item.orderId === orderId)) throw new Error('这笔订单已经评价过了')
  writeLocal(REVIEWS_KEY, [{ orderId, productId: order.productId, buyerId: demoUser.id, sellerId: order.sellerId, school: campusConfig.schoolName, rating, content: content.trim(), createdAt: Date.now() }, ...mockReviews()])
  return { created: true }
}

export async function getOrderReview(orderId: string): Promise<OrderReviewState> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('getOrderReview', { orderId })
  if (mode === 'api') return apiRequest(`/me/orders/${encodeURIComponent(orderId)}/review`)
  await getOrder(orderId)
  const review = mockReviews().find(item => item.orderId === orderId)
  return review ? { reviewed: true, review: publicReview(review) } : { reviewed: false }
}

export async function getSellerReviewSummary(sellerId: string): Promise<SellerReviewSummary> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('getSellerReviewSummary', { sellerId })
  if (mode === 'api') return apiRequest(`/sellers/${encodeURIComponent(sellerId)}/review-summary`)
  const reviews = mockReviews().filter(item => item.sellerId === sellerId && item.school === campusConfig.schoolName)
  return { averageRating: reviews.length ? Math.round(reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length * 10) / 10 : 0, reviewCount: reviews.length }
}

export async function listSellerReviews(sellerId: string): Promise<SellerReview[]> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('listSellerReviews', { sellerId })
  if (mode === 'api') return apiRequest(`/sellers/${encodeURIComponent(sellerId)}/reviews`)
  return mockReviews().filter(item => item.sellerId === sellerId && item.school === campusConfig.schoolName).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(publicReview)
}
