import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import ProductCard from '../../components/ProductCard'
import ProductGridSkeleton from '../../components/ProductGridSkeleton'
import { clearRecentViews, listRecentViews } from '../../services/recentViews'
import type { Product } from '../../types/market'

export default function HistoryPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const busy = useRef(false)
  const load = () => {
    setLoading(true); setLoadError('')
    listRecentViews().then(setProducts).catch(() => setLoadError('请检查网络或云环境后重试')).finally(() => setLoading(false))
  }
  useDidShow(load)

  const clear = async () => {
    if (busy.current) return
    const decision = await Taro.showModal({ title: '清空浏览记录', content: '确定清空最近浏览吗？商品本身不会删除。', confirmText: '清空', confirmColor: '#c8665d' })
    if (!decision.confirm) return
    busy.current = true
    try {
      await clearRecentViews()
      setProducts([])
      Taro.showToast({ title: '浏览记录已清空', icon: 'none' })
    } catch { Taro.showToast({ title: '暂时无法清空，请稍后重试', icon: 'none' }) }
    finally { busy.current = false }
  }

  return <View className='page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>RECENTLY VIEWED</Text><Text className='page-heading__title'>最近浏览</Text><Text className='page-heading__desc'>最近看过的好物都在这里</Text></View>
    <View className='content-pad'>
      <View className='history-toolbar'><Text>{loading ? '正在整理足迹…' : `最近浏览 ${products.length} 件`}</Text><Text className='history-toolbar__clear' onClick={clear}>清空浏览记录</Text></View>
      {loading ? <ProductGridSkeleton /> : loadError ? <EmptyState kind='error' title='浏览记录暂时无法加载' description={loadError} action='重试' onAction={load} /> : products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} showStatus />)}</View> : <EmptyState kind='search' title='还没有浏览记录' description='去首页逛逛校园好物吧' action='去逛逛' onAction={() => Taro.reLaunch({ url: '/pages/index/index' })} />}
    </View>
  </View>
}
