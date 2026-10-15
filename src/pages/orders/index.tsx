import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import { Badge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import { getOrderUnreadSummary, listOrders, markOrdersRead } from '../../services/orders'
import type { MarketOrder, OrderRole, OrderUnreadSummary } from '../../types/market'
import { formatOrderTime, orderStatusLabels, unreadCountLabel } from '../../utils/orders'

const emptyUnread: OrderUnreadSummary = { buyer: 0, seller: 0, total: 0 }

export default function OrdersPage() {
  const [role, setRole] = useState<OrderRole>('buyer')
  const [orders, setOrders] = useState<MarketOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [unread, setUnread] = useState<OrderUnreadSummary>(emptyUnread)
  const requestId = useRef(0)
  const unreadRequestId = useRef(0)
  const unreadReady = useRef<Promise<void>>(Promise.resolve())
  const loadUnread = () => {
    const request = ++unreadRequestId.current
    unreadReady.current = getOrderUnreadSummary().then(summary => { if (request === unreadRequestId.current) setUnread(summary) }).catch(() => { if (request === unreadRequestId.current) setUnread(emptyUnread) })
  }
  const load = (nextRole: OrderRole) => {
    const request = ++requestId.current
    setLoading(true); setError(false)
    listOrders(nextRole).then(async items => {
      if (request !== requestId.current) return
      // Keep this response's unread snapshot on the cards until the next visit.
      setOrders(items)
      setLoading(false)
      try {
        // Let the summary arrive before clearing one role, so the other tab keeps its count.
        await unreadReady.current
        if (request !== requestId.current) return
        await markOrdersRead(nextRole)
        setUnread(previous => ({ ...previous, [nextRole]: 0, total: previous.total - previous[nextRole] }))
      } catch { /* Keep the badge if the server could not save the read state. */ }
    }).catch(() => { if (request === requestId.current) setError(true) }).finally(() => { if (request === requestId.current) setLoading(false) })
  }
  useDidShow(() => { loadUnread(); load(role) })
  const changeRole = (nextRole: OrderRole) => { if (nextRole !== role) { setRole(nextRole); load(nextRole) } }

  return <View className='page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>CAMPUS ORDERS</Text><Text className='page-heading__title'>我的订单</Text><Text className='page-heading__desc'>和同学约好面交，见面验货后自行付款。</Text></View>
    <View className='content-pad orders-content'>
      <View className='order-tabs'><Text className={role === 'buyer' ? 'is-selected' : ''} onClick={() => changeRole('buyer')}>我买到的{unread.buyer > 0 && <Badge tone='danger'>{unreadCountLabel(unread.buyer)}</Badge>}</Text><Text className={role === 'seller' ? 'is-selected' : ''} onClick={() => changeRole('seller')}>我卖出的{unread.seller > 0 && <Badge tone='danger'>{unreadCountLabel(unread.seller)}</Badge>}</Text></View>
      {loading ? <View className='listing-skeleton'><View /><View /></View> : error ? <EmptyState kind='error' title='订单暂时没加载出来' description='检查网络后再试一次' action='重试' onAction={() => load(role)} /> : orders.length ? orders.map(order =>
        <View key={order.id} className='order-card' onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(order.id)}` })}>
          <View className='order-card__top'><Text>{role === 'buyer' ? '我买到的' : '我卖出的'}</Text><View className='order-card__badges'>{order.unread && <Badge tone='danger'>新</Badge>}<Badge tone={order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'neutral' : 'warning'}>{orderStatusLabels[order.status]}</Badge></View></View>
          <View className='order-card__product'><ProductPhoto src={order.productImage} className='order-card__photo' /><View className='order-card__info'><Text className='order-card__title'>{order.productTitle}</Text><Text className='order-card__price'>¥{order.amount}</Text></View></View>
          <View className='order-card__bottom'><Text>{role === 'buyer' ? '卖家' : '买家'}：{order.other.nickname}</Text><Text>{formatOrderTime(order.createdAt)}</Text></View>
        </View>) : <EmptyState kind='orders' title={role === 'buyer' ? '还没有买到的好物' : '还没有收到订单'} description={role === 'buyer' ? '逛逛校园好物，找到喜欢的再发起订单' : '分享闲置，让需要的同学发现它'} action={role === 'buyer' ? '去逛逛' : '去发布'} onAction={() => Taro.reLaunch({ url: role === 'buyer' ? '/pages/index/index' : '/pages/publish/index' })} />}
    </View>
  </View>
}
