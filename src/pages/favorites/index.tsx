import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import EmptyState from '../../components/EmptyState'
import ProductCard from '../../components/ProductCard'
import TabNav from '../../components/TabNav'
import { getFavorites } from '../../services/products'
import type { Product } from '../../types/market'

export default function FavoritesPage() {
  const [products, setProducts] = useState<Product[]>([])
  useDidShow(() => { getFavorites().then(setProducts).catch(error => Taro.showToast({ title: error.message, icon: 'none' })) })
  return <View className='page page--with-nav'><View className='page-heading'><Text className='eyebrow'>SAVED FOR LATER</Text><Text className='page-heading__title'>心动清单</Text><Text className='page-heading__desc'>喜欢的好物，都在这里。</Text></View><View className='content-pad'><View className='results-bar'><Text>已收藏 {products.length} 件好物</Text></View>{products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View> : <View><EmptyState icon='♡' title='还没有收藏好物' description='逛逛首页，遇见喜欢的就点一下收藏吧' /><View className='button-outline empty-action' onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}>去逛逛</View></View>}</View><TabNav active='favorites' /></View>
}
