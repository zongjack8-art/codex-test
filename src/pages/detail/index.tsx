import { Image, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import Avatar from '../../components/Avatar'
import { Badge, StatusBadge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import ProductPhoto from '../../components/ProductPhoto'
import { campusConfig } from '../../config/campus'
import { startConversation } from '../../services/chat'
import { getFavoriteIds, getProduct, toggleFavorite } from '../../services/products'
import { submitReport, type ReportReason } from '../../services/reports'
import { createOrder } from '../../services/orders'
import { getSellerReviewSummary } from '../../services/reviews'
import type { Product, SellerReviewSummary } from '../../types/market'
import { formatDetailTime } from '../../utils/format'
import { retainRouteId } from '../../utils/routeId'
import { detailPermissions } from './permissions'

const reportReasons: { value: ReportReason; label: string }[] = [
  { value: 'prohibited', label: '违规商品' },
  { value: 'misleading', label: '虚假信息' },
  { value: 'fraud', label: '疑似诈骗' },
  { value: 'other', label: '其他' }
]

export default function DetailPage() {
  const productIdRef = useRef('')
  retainRouteId(productIdRef, getCurrentInstance().router?.params?.id)
  const [product, setProduct] = useState<Product | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [contactBusy, setContactBusy] = useState(false)
  const [orderBusy, setOrderBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason | null>(null)
  const [reportDescription, setReportDescription] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportSubmitted, setReportSubmitted] = useState(false)
  const [sellerReviewSummary, setSellerReviewSummary] = useState<SellerReviewSummary | null>(null)
  const [sellerReviewError, setSellerReviewError] = useState(false)
  const favoriteBusyRef = useRef(false)
  const contactBusyRef = useRef(false)
  const reportBusyRef = useRef(false)
  const orderBusyRef = useRef(false)
  const load = () => {
    const id = retainRouteId(productIdRef, getCurrentInstance().router?.params?.id)
    setLoading(true)
    setLoadError('')
    setFavorite(false)
    setSellerReviewSummary(null); setSellerReviewError(false)
    if (!id) { setProduct(null); setLoadError('商品链接缺少编号'); setLoading(false); return }
    getProduct(id).then(item => {
      setProduct(item)
      if (item) getSellerReviewSummary(item.seller.id).then(setSellerReviewSummary).catch(() => setSellerReviewError(true))
      if (item && detailPermissions(item).canFavorite) getFavoriteIds().then(ids => setFavorite(ids.includes(id))).catch(() => undefined)
    }).catch(() => setLoadError('请检查网络或云环境后重试')).finally(() => setLoading(false))
  }
  useDidShow(load)

  const onFavorite = async () => {
    const id = productIdRef.current
    if (!id || favoriteBusyRef.current || !product || !detailPermissions(product).canFavorite) return
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
    if (!product || contactBusyRef.current || !detailPermissions(product).canContact) return
    contactBusyRef.current = true
    setContactBusy(true)
    try {
      const conversation = await startConversation(product.id)
      await Taro.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(conversation.id)}` })
    } catch (error) { Taro.showToast({ title: (error as Error).message || '暂时无法联系卖家，请重试', icon: 'none' }) }
    finally { contactBusyRef.current = false; setContactBusy(false) }
  }

  const onReport = async () => {
    if (reportBusyRef.current || !product || !detailPermissions(product).canReport || !reportReason) return
    reportBusyRef.current = true
    setReportBusy(true)
    try {
      const result = await submitReport({ productId: product.id, reason: reportReason, description: reportReason === 'other' ? reportDescription.trim() : '' })
      setReportSubmitted(true)
      setReportOpen(false)
      Taro.showToast({ title: result.created ? '举报已提交，我们会尽快处理' : '这件商品已举报过', icon: 'none', duration: 2500 })
    } catch (error) { Taro.showToast({ title: (error as Error).message || '举报提交失败，请重试', icon: 'none' }) }
    finally { reportBusyRef.current = false; setReportBusy(false) }
  }

  const want = async () => {
    if (!product || !detailPermissions(product).canContact || orderBusyRef.current) return
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
  const permissions = detailPermissions(product)

  return <View className='page page--detail'>
    <View className='detail-gallery-wrap'>
      {product.images.length ? <ScrollView scrollX className='detail-gallery'><View className='detail-gallery__inner'>{product.images.map((image, index) => <Image key={`${image}-${index}`} src={image} mode='aspectFill' className='detail-gallery__image' onClick={() => Taro.previewImage({ current: image, urls: product.images })} />)}</View></ScrollView> : <ProductPhoto className='detail-gallery__fallback' />}
      {product.images.length > 0 && <Text className='detail-gallery__count'>{product.images.length} 张图片 · 点击查看</Text>}
    </View>
    <View className='detail-content'>
      <View className='detail-summary'>
        <View className='detail-summary__price'><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text>{product.originalPrice && <Text className='detail-summary__old'>原价 ¥{product.originalPrice}</Text>}</View>
        <Text className='detail-summary__title'>{product.title}</Text>
        <View className='detail-summary__meta'><StatusBadge status={product.status} /><Badge tone='primary'>{product.condition}</Badge><Text>发布于 {formatDetailTime(product.createdAt)}</Text></View>
      </View>
      <View className='detail-section'><Text className='detail-section__title'>关于这件好物</Text><Text className='detail-section__body'>{product.description}</Text></View>
      <View className='detail-section detail-trade'><Text className='detail-section__title'>校内交易</Text><View className='detail-trade__row'><View className='detail-trade__icon'><Icon name='pin' size='md' /></View><View><Text>面交地点</Text><Text>{product.campus} · 可与卖家约校内公共区域</Text></View></View><View className='detail-trade__row'><View className='detail-trade__icon'><Icon name='shield' size='md' /></View><View><Text>安心提醒</Text><Text>见面确认商品状态，再完成交易</Text></View></View></View>
      <View className='detail-section detail-seller'><Text className='detail-section__title'>发布同学</Text><View className='detail-seller__row'><Avatar className='detail-seller__avatar' value={product.seller.avatar} /><View className='detail-seller__info'><Text className='detail-seller__name'>{product.seller.nickname || '校园同学'}</Text><Text>{campusConfig.schoolName}</Text><Text>{product.seller.campus || campusConfig.campusName}</Text></View><Badge tone='primary'>校园用户</Badge></View><View className='detail-seller__review' onClick={() => Taro.navigateTo({ url: `/pages/seller-reviews/index?id=${encodeURIComponent(product.seller.id)}` })}><Text>{sellerReviewError ? '信用评分暂不可用' : !sellerReviewSummary ? '正在读取信用评分…' : sellerReviewSummary.reviewCount ? `信用评分 ${sellerReviewSummary.averageRating.toFixed(1)} · ${sellerReviewSummary.reviewCount} 条评价` : '暂无评价'}</Text><Icon name='chevron' size='sm' /></View></View>
      {permissions.canReport && <View className='detail-report'>
        {reportSubmitted ? <Text className='detail-report__done'>已提交举报，感谢你帮助维护校园集市</Text> : <Text className='detail-report__trigger' onClick={() => setReportOpen(value => !value)}>{reportOpen ? '收起举报' : '发现商品有问题？举报'}</Text>}
        {reportOpen && !reportSubmitted && <View className='detail-report__form'>
          <Text className='detail-report__title'>请选择举报原因</Text>
          <View className='detail-report__reasons'>{reportReasons.map(item => <Text key={item.value} className={`detail-report__reason ${reportReason === item.value ? 'is-selected' : ''}`} onClick={() => setReportReason(item.value)}>{item.label}</Text>)}</View>
          {reportReason === 'other' && <Textarea className='detail-report__description' maxlength={500} value={reportDescription} onInput={event => setReportDescription(event.detail.value)} placeholder='补充说明（选填，最多 500 字）' />}
          <AppButton variant='secondary' block disabled={!reportReason} loading={reportBusy} onClick={onReport}>提交举报</AppButton>
        </View>}
      </View>}
      <View className='detail-safe-note'><Icon name='shield' size='sm' /><Text>选择校内公共地点面交，请勿提前转账。</Text></View>
    </View>
    <View className='detail-actions'>
      {!permissions.ownershipKnown ? <AppButton block variant='secondary' onClick={load}>重新加载商品信息</AppButton> : permissions.canManage ? <AppButton block onClick={() => Taro.navigateTo({ url: product.status === 'reserved' ? '/pages/orders/index?role=seller' : product.status === 'sold' ? '/pages/my-listings/index' : `/pages/publish/index?id=${encodeURIComponent(product.id)}` })}>{product.status === 'reserved' ? '交易中 · 查看我的订单' : product.status === 'sold' ? '查看我的发布' : '编辑商品'}</AppButton> : permissions.canContact ? <><View className={`detail-actions__favorite ${favorite ? 'is-active' : ''} ${favoriteBusy ? 'is-busy' : ''}`} onClick={onFavorite}><Icon name='heart' size='md' /><Text>{favorite ? '已收藏' : '收藏'}</Text></View><AppButton className='detail-actions__want' variant='secondary' onClick={want} loading={orderBusy}>我想要</AppButton><AppButton className='detail-actions__contact' onClick={contact} loading={contactBusy}>联系卖家</AppButton></> : <Text className='detail-actions__status'>{product.status === 'reserved' ? '该商品已进入交易中，暂不可发起新订单或联系卖家' : product.status === 'sold' ? '商品已售出，暂不可联系卖家或发起订单' : '商品已下架，暂不可联系卖家或发起订单'}</Text>}
    </View>
  </View>
}
