import { Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import { Badge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import { changeOrder, getOrder } from '../../services/orders'
import { getOrderReview } from '../../services/reviews'
import type { MarketOrder, OrderReviewState } from '../../types/market'
import { formatOrderTime, orderActions, orderStatusLabels } from '../../utils/orders'
import { ratingStars } from '../../utils/reviews'
import { retainRouteId } from '../../utils/routeId'

type Action = 'confirmOrder' | 'completeOrder' | 'cancelOrder'

export default function OrderDetailPage() {
  const orderIdRef = useRef('')
  retainRouteId(orderIdRef, getCurrentInstance().router?.params?.id)
  const [order, setOrder] = useState<MarketOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewState, setReviewState] = useState<OrderReviewState | null>(null)
  const [reviewError, setReviewError] = useState(false)
  const busyRef = useRef(false)
  const load = () => {
    const id = retainRouteId(orderIdRef, getCurrentInstance().router?.params?.id)
    setLoading(true); setError(false)
    if (!id) { setOrder(null); setError(true); setLoading(false); return }
    setReviewState(null); setReviewError(false)
    getOrder(id).then(current => {
      setOrder(current)
      if (current.status === 'completed') getOrderReview(id).then(setReviewState).catch(() => setReviewError(true))
    }).catch(() => setError(true)).finally(() => setLoading(false))
  }
  useDidShow(load)

  const act = async (action: Action) => {
    const id = orderIdRef.current
    if (!id || !order || !orderActions(order).includes(action) || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const label = action === 'confirmOrder' ? '确认接单' : action === 'completeOrder' ? '确认已完成交易' : '取消订单'
      const result = await Taro.showModal({ title: label, content: action === 'completeOrder' ? '请确认双方已经面交，商品将标记为已售。平台不会收款。' : action === 'cancelOrder' ? '确定取消这笔订单吗？' : '确认后请与买家约定面交时间和地点。' })
      if (!result.confirm) return
      const updated = await changeOrder(id, action)
      setOrder(updated)
      if (updated.status === 'completed') getOrderReview(id).then(setReviewState).catch(() => setReviewError(true))
      Taro.showToast({ title: action === 'confirmOrder' ? '已确认，记得约好面交' : action === 'completeOrder' ? '订单已完成' : '订单已取消', icon: 'none' })
    } catch (failure) { Taro.showToast({ title: (failure as Error).message || '操作失败，请重试', icon: 'none' }) }
    finally { busyRef.current = false; setBusy(false) }
  }

  if (loading) return <View className='page'><View className='listing-skeleton'><View /><View /></View></View>
  if (error || !order) return <View className='page'><EmptyState kind='error' title='订单暂时无法查看' description='订单不存在、无权访问或网络暂时不可用' action='重试' onAction={load} /></View>
  const actions = orderActions(order)
  return <View className='page order-detail-page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>ORDER DETAIL</Text><Text className='page-heading__title'>订单详情</Text><Text className='page-heading__desc'>校园内约好面交，见面验货后自行付款。</Text></View>
    <View className='content-pad'>
      <View className='order-detail-status'><Badge tone={order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'neutral' : 'warning'}>{orderStatusLabels[order.status]}</Badge><Text>{order.status === 'pending' ? '等待卖家确认后，再约面交时间' : order.status === 'confirmed' ? '和对方约好时间地点，当面确认商品' : order.status === 'completed' ? '这次校园好物交换已完成' : '这笔订单已结束'}</Text></View>
      <View className='order-card order-detail-product'><View className='order-card__product'><ProductPhoto src={order.productImage} className='order-card__photo' /><View className='order-card__info'><Text className='order-card__title'>{order.productTitle}</Text><Text className='order-card__price'>¥{order.amount}</Text></View></View></View>
      <View className='order-detail-facts'><View><Text>我的身份</Text><Text>{order.role === 'buyer' ? '买家' : '卖家'}</Text></View><View><Text>{order.role === 'buyer' ? '卖家' : '买家'}</Text><Text>{order.other.nickname}</Text></View><View><Text>创建时间</Text><Text>{formatOrderTime(order.createdAt)}</Text></View>{order.completedAt && <View><Text>完成时间</Text><Text>{formatOrderTime(order.completedAt)}</Text></View>}{order.cancelledAt && <View><Text>取消时间</Text><Text>{formatOrderTime(order.cancelledAt)}</Text></View>}</View>
      {order.status === 'completed' && <View className='order-review-panel'>
        <Text className='order-review-panel__title'>交易评价</Text>
        {reviewError ? <Text className='order-review-panel__retry' onClick={() => { setReviewError(false); getOrderReview(order.id).then(setReviewState).catch(() => setReviewError(true)) }}>评价暂时没加载出来，点击重试</Text> : !reviewState ? <Text className='order-review-panel__hint'>正在读取评价…</Text> : reviewState.reviewed && reviewState.review ? <><Text className='order-review-panel__stars'>{order.role === 'buyer' ? '已评价' : '买家评价'} {ratingStars(reviewState.review.rating)}</Text>{reviewState.review.content && <Text className='order-review-panel__content'>{reviewState.review.content}</Text>}</> : order.role === 'buyer' ? <AppButton variant='secondary' onClick={() => Taro.navigateTo({ url: `/pages/review/index?id=${encodeURIComponent(order.id)}` })}>评价卖家</AppButton> : <Text className='order-review-panel__hint'>买家还没有留下评价</Text>}
      </View>}
      <View className='order-detail-note'>订单用于和同学约定面交；建议在校内公共区域验货，双方自行付款。平台不代收款。</View>
      {actions.length > 0 && <View className='order-detail-actions'>{actions.includes('confirmOrder') && <AppButton block loading={busy} onClick={() => act('confirmOrder')}>确认订单</AppButton>}{actions.includes('completeOrder') && <AppButton block loading={busy} onClick={() => act('completeOrder')}>确认已完成交易</AppButton>}{actions.includes('cancelOrder') && <AppButton block variant='secondary' disabled={busy} onClick={() => act('cancelOrder')}>{order.role === 'seller' && order.status === 'pending' ? '拒绝订单' : '取消订单'}</AppButton>}</View>}
    </View>
  </View>
}
