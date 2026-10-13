import { Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import { StatusBadge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import ProductPhoto from '../../components/ProductPhoto'
import { deleteProduct, getMyProducts, setProductStatus } from '../../services/products'
import type { Product, ProductStatus } from '../../types/market'
import { formatProductTime } from '../../utils/format'

const filters: { label: string; status: ProductStatus | 'all' }[] = [
  { label: '全部', status: 'all' },
  { label: '在售', status: 'selling' },
  { label: '已售', status: 'sold' },
  { label: '已下架', status: 'offline' }
]

export default function MyListingsPage() {
  const routeStatus = getCurrentInstance().router?.params?.status
  const [products, setProducts] = useState<Product[]>([])
  const [statusFilter, setStatusFilter] = useState<ProductStatus | 'all'>(filters.some(item => item.status === routeStatus) ? routeStatus as ProductStatus : 'all')
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const load = () => {
    setLoading(true)
    return getMyProducts().then(setProducts).catch(error => Taro.showToast({ title: error.message, icon: 'none' })).finally(() => setLoading(false))
  }
  useDidShow(load)

  const update = async (product: Product, status: ProductStatus) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPendingId(product.id)
    try {
      if (status !== 'selling') {
        const result = await Taro.showModal({ title: status === 'sold' ? '确认售出' : '确认下架', content: `确定将「${product.title}」${status === 'sold' ? '标记为已售' : '下架'}吗？` })
        if (!result.confirm) return
      }
      await setProductStatus(product.id, status)
      await load()
      Taro.showToast({ title: '状态已更新', icon: 'none' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { pendingRef.current = false; setPendingId(null) }
  }

  const remove = async (product: Product) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPendingId(product.id)
    try {
      const result = await Taro.showModal({ title: '删除商品', content: `确定删除「${product.title}」吗？删除后无法恢复。` })
      if (!result.confirm) return
      await deleteProduct(product.id)
      await load()
      Taro.showToast({ title: '已删除', icon: 'none' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { pendingRef.current = false; setPendingId(null) }
  }

  const showMore = async (product: Product) => {
    if (pendingRef.current) return
    const actions: { label: string; run: () => Promise<void> }[] = product.status === 'selling'
      ? [{ label: '标记已售', run: () => update(product, 'sold') }, { label: '下架商品', run: () => update(product, 'offline') }, { label: '删除商品', run: () => remove(product) }]
      : product.status === 'sold'
        ? [{ label: '重新上架', run: () => update(product, 'selling') }, { label: '下架商品', run: () => update(product, 'offline') }, { label: '删除商品', run: () => remove(product) }]
        : [{ label: '重新上架', run: () => update(product, 'selling') }, { label: '删除商品', run: () => remove(product) }]
    try { const result = await Taro.showActionSheet({ itemList: actions.map(item => item.label) }); await actions[result.tapIndex]?.run() }
    catch (error) { if (!String((error as Error).message).includes('cancel')) Taro.showToast({ title: '操作未完成，请重试', icon: 'none' }) }
  }

  const visible = statusFilter === 'all' ? products : products.filter(product => product.status === statusFilter)

  return <View className='page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>MY LISTINGS</Text><Text className='page-heading__title'>我的发布</Text><Text className='page-heading__desc'>每件闲置的去向，都由你来安排。</Text></View>
    <View className='content-pad listings-content'>
      <View className='listing-filters'>{filters.map(item => <Text key={item.status} className={`listing-filter ${statusFilter === item.status ? 'is-selected' : ''}`} onClick={() => setStatusFilter(item.status)}>{item.label}</Text>)}</View>
      <View className='results-bar results-bar--single'><Text>{loading ? '正在整理你的好物…' : statusFilter === 'all' ? `共发布 ${products.length} 件` : `${filters.find(item => item.status === statusFilter)?.label} · ${visible.length} 件`}</Text></View>
      {loading ? <View className='listing-skeleton'><View /><View /></View> : visible.length ? visible.map(product => <View className={`listing-card ${pendingId === product.id ? 'listing-card--pending' : ''}`} key={product.id}>
        <View className='listing-card__main' onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` })}><ProductPhoto src={product.images[0]} className='listing-card__photo' /><View className='listing-card__info'><Text className='listing-card__title'>{product.title}</Text><View className='listing-card__meta'><StatusBadge status={product.status} /><Text>{formatProductTime(product.createdAt)}</Text></View><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text></View></View>
        <View className='listing-card__footer'><View className='listing-card__location'><Icon name='pin' size='sm' /><Text>{product.campus}</Text></View><View className='listing-card__actions'><Text onClick={() => !pendingRef.current && Taro.navigateTo({ url: `/pages/publish/index?id=${encodeURIComponent(product.id)}` })}>编辑</Text><View onClick={() => showMore(product)}><Icon name='more' size='sm' /><Text>更多操作</Text></View></View></View>
      </View>) : <EmptyState kind={statusFilter === 'sold' ? 'sold' : 'listings'} title={products.length ? '这里还没有商品' : '还没有发布闲置'} description={products.length ? '切换状态，看看其他好物' : '拍张照片，给闲置找个新主人'} action={products.length ? '查看全部' : '去发布'} onAction={products.length ? () => setStatusFilter('all') : () => Taro.reLaunch({ url: '/pages/publish/index' })} />}
    </View>
  </View>
}
