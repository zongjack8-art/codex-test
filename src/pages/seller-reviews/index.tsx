import { Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import { getSellerReviewSummary, listSellerReviews } from '../../services/reviews'
import type { SellerReview, SellerReviewSummary } from '../../types/market'
import { formatDetailTime } from '../../utils/format'
import { ratingStars } from '../../utils/reviews'
import { retainRouteId } from '../../utils/routeId'
import './index.scss'

export default function SellerReviewsPage() {
  const sellerIdRef = useRef('')
  retainRouteId(sellerIdRef, getCurrentInstance().router?.params?.id)
  const [summary, setSummary] = useState<SellerReviewSummary>({ averageRating: 0, reviewCount: 0 })
  const [reviews, setReviews] = useState<SellerReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const load = async () => {
    const id = retainRouteId(sellerIdRef, getCurrentInstance().router?.params?.id)
    if (!id) { setError(true); setLoading(false); return }
    setLoading(true); setError(false)
    try {
      const [nextSummary, nextReviews] = await Promise.all([getSellerReviewSummary(id), listSellerReviews(id)])
      setSummary(nextSummary); setReviews(nextReviews)
    } catch { setError(true) }
    finally { setLoading(false) }
  }
  useDidShow(() => { void load() })
  if (loading) return <View className='page'><View className='listing-skeleton'><View /><View /></View></View>
  if (error) return <View className='page'><EmptyState kind='error' title='评价暂时无法加载' description='请检查网络后重试' action='重试' onAction={() => { void load() }} /></View>
  return <View className='page seller-reviews-page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>CAMPUS TRUST</Text><Text className='page-heading__title'>卖家评价</Text><Text className='page-heading__desc'>看看同学们真实完成交易后的反馈</Text></View>
    <View className='content-pad seller-reviews-content'>
      <View className='seller-reviews-summary'><Text className='seller-reviews-summary__score'>{summary.reviewCount ? summary.averageRating.toFixed(1) : '—'}</Text><View><Text className='seller-reviews-summary__stars'>{summary.reviewCount ? ratingStars(summary.averageRating) : '暂无评价'}</Text><Text className='seller-reviews-summary__count'>{summary.reviewCount} 条交易评价</Text></View></View>
      {reviews.length ? <><Text className='seller-reviews-heading'>最近评价</Text>{reviews.map((review, index) => <View key={`${review.createdAt}-${index}`} className='seller-review-card'><View className='seller-review-card__top'><Text className='seller-review-card__stars'>{ratingStars(review.rating)}</Text><Text className='seller-review-card__time'>{formatDetailTime(review.createdAt)}</Text></View><Text className='seller-review-card__content'>{review.content || '同学给出了星级评价'}</Text></View>)}</> : <EmptyState kind='listings' title='暂无评价' description='完成交易后，买家可以留下第一条评价' />}
    </View>
  </View>
}
