import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import ProductCard from '../../components/ProductCard'
import ProductGridSkeleton from '../../components/ProductGridSkeleton'
import TabNav from '../../components/TabNav'
import { getFavorites, toggleFavorite } from '../../services/products'
import type { Product } from '../../types/market'

export default function FavoritesPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const busyRef = useRef(false)
  useDidShow(() => { setLoading(true); getFavorites().then(setProducts).catch(error => Taro.showToast({ title: error.message, icon: 'none' })).finally(() => setLoading(false)) })

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

  return <View className='page page--with-nav'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>SAVED FOR LATER</Text><Text className='page-heading__title'>我的心动清单</Text><Text className='page-heading__desc'>喜欢的先收好，想起来就回来看看。</Text></View>
    <View className='content-pad'><View className='results-bar results-bar--single'><Text>{loading ? '正在整理清单…' : `已收藏 ${products.length} 件好物`}</Text></View>
      {loading ? <ProductGridSkeleton /> : products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} favorite onFavorite={remove} />)}</View> : <EmptyState kind='favorites' title='还没有收藏的宝贝' description='逛一逛，也许能遇到刚好需要的东西' action='去逛逛' onAction={() => Taro.reLaunch({ url: '/pages/index/index' })} />}
    </View>
    <TabNav active='favorites' />
  </View>
}
