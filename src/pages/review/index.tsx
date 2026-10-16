import { Text, Textarea, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import { getOrder } from '../../services/orders'
import { createReview, getOrderReview } from '../../services/reviews'
import type { MarketOrder } from '../../types/market'
import { retainRouteId } from '../../utils/routeId'
import './index.scss'

export default function ReviewPage() {
  const orderIdRef = useRef('')
  retainRouteId(orderIdRef, getCurrentInstance().router?.params?.id)
  const [order, setOrder] = useState<MarketOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [alreadyReviewed, setAlreadyReviewed] = useState(false)
  const [rating, setRating] = useState(0)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const load = async () => {
    const id = retainRouteId(orderIdRef, getCurrentInstance().router?.params?.id)
    if (!id) { setError(true); setLoading(false); return }
    setLoading(true); setError(false)
    try {
      const current = await getOrder(id)
      setOrder(current)
      if (current.role === 'buyer' && current.status === 'completed') {
        const review = await getOrderReview(id)
        setAlreadyReviewed(review.reviewed)
      }
    } catch { setError(true) }
    finally { setLoading(false) }
  }
  useDidShow(() => { void load() })
  const submit = async () => {
    if (busyRef.current || !order || order.role !== 'buyer' || order.status !== 'completed' || alreadyReviewed) return
    if (!rating) { Taro.showToast({ title: '请先选择星级', icon: 'none' }); return }
    busyRef.current = true; setBusy(true)
    try {
      await createReview(order.id, rating, content)
      setAlreadyReviewed(true)
      Taro.showToast({ title: '评价成功', icon: 'success' })
      await Taro.navigateBack({ delta: 1 })
    } catch (failure) { Taro.showToast({ title: (failure as Error).message || '评价提交失败，请重试', icon: 'none' }) }
    finally { busyRef.current = false; setBusy(false) }
  }
  if (loading) return <View className='page'><View className='listing-skeleton'><View /><View /></View></View>
  if (error || !order) return <View className='page'><EmptyState kind='error' title='评价页面暂时无法打开' description='请检查订单或网络后重试' action='重试' onAction={() => { void load() }} /></View>
  if (order.role !== 'buyer' || order.status !== 'completed' || alreadyReviewed) return <View className='page'><EmptyState kind='orders' title={alreadyReviewed ? '这笔订单已经评价过啦' : '这笔订单还不能评价'} action='返回订单' onAction={() => Taro.navigateBack({ delta: 1 })} /></View>
  return <View className='page review-page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>CAMPUS REVIEW</Text><Text className='page-heading__title'>评价卖家</Text><Text className='page-heading__desc'>说说这次校内面交的体验</Text></View>
    <View className='content-pad review-content'>
      <View className='order-card review-product'><View className='order-card__product'><ProductPhoto src={order.productImage} className='order-card__photo' /><View className='order-card__info'><Text className='order-card__title'>{order.productTitle}</Text><Text className='order-card__price'>¥{order.amount}</Text><Text className='review-product__seller'>卖家：{order.other.nickname}</Text></View></View></View>
      <View className='review-form'><Text className='review-form__title'>这次交易体验如何？</Text><View className='review-form__stars'>{[1, 2, 3, 4, 5].map(value => <Text key={value} className={`review-form__star ${value <= rating ? 'is-selected' : ''}`} onClick={() => setRating(value)}>{value <= rating ? '★' : '☆'}</Text>)}</View><Text className='review-form__hint'>{rating ? `${rating} 星 · ${rating >= 4 ? '很满意' : rating === 3 ? '还不错' : '期待更好的体验'}` : '点击星星选择评分'}</Text>
        <Textarea className='review-form__input' value={content} maxlength={200} onInput={event => setContent(event.detail.value)} placeholder='说说商品和面交体验（选填，最多 200 字）' /><Text className='review-form__count'>{content.length}/200</Text>
      </View>
      <AppButton block loading={busy} disabled={!rating} onClick={submit}>提交评价</AppButton>
    </View>
  </View>
}
