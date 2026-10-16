import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import ProductCard from '../../components/ProductCard'
import ProductGridSkeleton from '../../components/ProductGridSkeleton'
import { getFavorites, toggleFavorite } from '../../services/products'
import type { Product } from '../../types/market'
import { filterFavoriteProducts, type FavoriteFilter } from '../../utils/favorites'

const filters: { label: string; value: FavoriteFilter }[] = [
  { label: '全部', value: 'all' }, { label: '在售', value: 'selling' },
  { label: '交易中', value: 'reserved' }, { label: '已售', value: 'sold' }
]

export default function FavoritesPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState<FavoriteFilter>('all')
  const busyRef = useRef(false)
  const load = () => { setLoading(true); setLoadError(''); getFavorites().then(setProducts).catch(() => setLoadError('请检查网络或云环境后重试')).finally(() => setLoading(false)) }
  useDidShow(load)
  const visible = filterFavoriteProducts(products, status)

  const remove = async (product: Product) => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const nowFavorite = await toggleFavorite(product.id)
      if (!nowFavorite) setProducts(current => current.filter(item => item.id !== product.id))
      Taro.showToast({ title: nowFavorite ? '已加入收藏' : '已取消收藏', icon: 'none' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { busyRef.current = false }
  }

  return <View className='page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>SAVED FOR LATER</Text><Text className='page-heading__title'>我的心动清单</Text><Text className='page-heading__desc'>喜欢的先收好，想起来就回来看看。</Text></View>
    <View className='content-pad'>
      <ScrollView scrollX className='filter-scroll favorites-filter'><View className='filter-chips'>{filters.map(item => <Text key={item.value} className={`chip ${status === item.value ? 'chip--active' : ''}`} onClick={() => setStatus(item.value)}>{item.label}</Text>)}</View></ScrollView>
      <View className='results-bar results-bar--single'><Text>{loading ? '正在整理清单…' : `找到 ${visible.length} 件好物`}</Text></View>
      {loading ? <ProductGridSkeleton /> : loadError ? <EmptyState kind='error' title='暂时没能打开收藏' description={loadError} action='重试' onAction={load} /> : visible.length ? <View className='product-grid'>{visible.map(product => <ProductCard key={product.id} product={product} favorite showStatus onFavorite={remove} />)}</View> : products.length ? <EmptyState kind='favorites' title='这个状态下还没有收藏' description='换个状态看看其他好物' action='查看全部' onAction={() => setStatus('all')} /> : <EmptyState kind='favorites' title='还没有收藏的宝贝' description='逛一逛，也许能遇到刚好需要的东西' action='去逛逛' onAction={() => Taro.reLaunch({ url: '/pages/index/index' })} />}
    </View>
  </View>
}
