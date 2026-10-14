import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import Avatar from '../../components/Avatar'
import { Badge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import ProductPhoto from '../../components/ProductPhoto'
import { startConversation } from '../../services/chat'
import { getFavoriteIds, getProduct, getProducts, toggleFavorite } from '../../services/products'
import { createOrder } from '../../services/orders'
import type { Product } from '../../types/market'
import { formatProductTime } from '../../utils/format'

export default function DetailPage() {
  const id = getCurrentInstance().router?.params?.id || ''
  const [product, setProduct] = useState<Product | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [contactBusy, setContactBusy] = useState(false)
  const [orderBusy, setOrderBusy] = useState(false)
  const [sellerCount, setSellerCount] = useState<number | null>(null)
  const favoriteBusyRef = useRef(false)
  const orderBusyRef = useRef(false)
  const load = () => {
    setLoading(true)
    setLoadError('')
    setSellerCount(null)
    setFavorite(false)
    getProduct(id).then(item => {
      setProduct(item)
      if (item) getProducts().then(items => setSellerCount(items.filter(value => value.seller.id === item.seller.id).length)).catch(() => undefined)
      if (item?.viewerIsSeller === false && item.status === 'selling') getFavoriteIds().then(ids => setFavorite(ids.includes(id))).catch(() => undefined)
    }).catch(() => setLoadError('请检查网络或云环境后重试')).finally(() => setLoading(false))
  }
  useDidShow(load)

  const onFavorite = async () => {
    if (favoriteBusyRef.current || product?.viewerIsSeller !== false || product.status !== 'selling') return
    favoriteBusyRef.current = true
    setFavoriteBusy(true)
    try {
      const next = await toggleFavorite(id)
      setFavorite(next)
      Taro.showToast({ title: next ? '已加入收藏' : '已取消收藏', icon: 'none' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { favoriteBusyRef.current = false; setFavoriteBusy(false) }
  }

  const contact = async () => {
    if (!product || contactBusy || product.viewerIsSeller !== false || product.status !== 'selling') return
    setContactBusy(true)
    try {
      const conversation = await startConversation(product.id)
      await Taro.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(conversation.id)}` })
    } catch (error) { Taro.showToast({ title: (error as Error).message || '暂时无法联系卖家，请重试', icon: 'none' }) }
    finally { setContactBusy(false) }
  }

  const want = async () => {
    if (!product || product.viewerIsSeller !== false || product.status !== 'selling' || orderBusyRef.current) return
    orderBusyRef.current = true
    setOrderBusy(true)
    try {
      const order = await createOrder(product.id)
      Taro.showToast({ title: '已向卖家发起订单', icon: 'none' })
      await Taro.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(order.id)}` })
    } catch (error) { Taro.showToast({ title: (error as Error).message || '发起订单失败，请重试', icon: 'none' }) }
    finally { orderBusyRef.current = false; setOrderBusy(false) }
  }

  if (loading) return <View className='page detail-loading'><View className='detail-skeleton'><View /><View /><View /></View></View>
  if (loadError) return <View className='page'><EmptyState kind='error' title='商品暂时无法加载' description={loadError} action='重试' onAction={load} /></View>
  if (!product) return <View className='page'><EmptyState kind='error' title='商品暂时找不到了' description='它可能已被删除，继续逛逛别的好物吧' action='返回首页' onAction={() => Taro.reLaunch({ url: '/pages/index/index' })} /></View>

  return <View className='page page--detail'>
    <View className='detail-gallery-wrap'>
      {product.images.length ? <ScrollView scrollX className='detail-gallery'><View className='detail-gallery__inner'>{product.images.map((image, index) => <Image key={`${image}-${index}`} src={image} mode='aspectFill' className='detail-gallery__image' onClick={() => Taro.previewImage({ current: image, urls: product.images })} />)}</View></ScrollView> : <ProductPhoto className='detail-gallery__fallback' />}
      {product.images.length > 0 && <Text className='detail-gallery__count'>{product.images.length} 张图片 · 点击查看</Text>}
    </View>
    <View className='detail-content'>
      <View className='detail-summary'>
        <View className='detail-summary__price'><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text>{product.originalPrice && <Text className='detail-summary__old'>原价 ¥{product.originalPrice}</Text>}</View>
        <Text className='detail-summary__title'>{product.title}</Text>
        <View className='detail-summary__meta'><Badge tone='primary'>{product.condition}</Badge><Text>{formatProductTime(product.createdAt)}</Text>{product.status !== 'selling' && <Badge tone={product.status === 'sold' ? 'neutral' : 'warning'}>{product.status === 'sold' ? '已售' : '已下架'}</Badge>}</View>
      </View>
      <View className='detail-section'><Text className='detail-section__title'>关于这件好物</Text><Text className='detail-section__body'>{product.description}</Text></View>
      <View className='detail-section detail-trade'><Text className='detail-section__title'>校内交易</Text><View className='detail-trade__row'><View className='detail-trade__icon'><Icon name='pin' size='md' /></View><View><Text>面交地点</Text><Text>{product.campus} · 可与卖家约校内公共区域</Text></View></View><View className='detail-trade__row'><View className='detail-trade__icon'><Icon name='shield' size='md' /></View><View><Text>安心提醒</Text><Text>见面确认商品状态，再完成交易</Text></View></View></View>
      <View className='detail-section detail-seller'><Text className='detail-section__title'>发布同学</Text><View className='detail-seller__row'><Avatar className='detail-seller__avatar' value={product.seller.avatar} /><View className='detail-seller__info'><Text className='detail-seller__name'>{product.seller.nickname}</Text><Text>{product.seller.campus} · 微信用户</Text></View>{sellerCount !== null && <Badge tone='accent'>在售 {sellerCount} 件</Badge>}</View></View>
      <View className='detail-safe-note'><Icon name='shield' size='sm' /><Text>选择校内公共地点面交，请勿提前转账。</Text></View>
    </View>
    <View className='detail-actions'>
      {product.viewerIsSeller === true ? <AppButton block onClick={() => Taro.navigateTo({ url: '/pages/my-listings/index' })}>管理我的商品</AppButton>
        : product.viewerIsSeller !== false ? <AppButton block variant='secondary' onClick={load}>重新加载商品信息</AppButton>
          : product.status === 'selling' ? <><View className={`detail-actions__favorite ${favorite ? 'is-active' : ''} ${favoriteBusy ? 'is-busy' : ''}`} onClick={onFavorite}><Icon name='heart' size='md' /><Text>{favorite ? '已收藏' : '收藏'}</Text></View><AppButton className='detail-actions__want' variant='secondary' onClick={want} loading={orderBusy}>我想要</AppButton><AppButton className='detail-actions__contact' onClick={contact} loading={contactBusy}>联系卖家</AppButton></>
            : <Text className='detail-actions__unavailable'>{product.status === 'sold' ? '商品已售出' : '商品已下架'}，暂不可发起订单</Text>}
    </View>
  </View>
}
