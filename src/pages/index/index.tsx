import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import ProductCard from '../../components/ProductCard'
import SectionTitle from '../../components/SectionTitle'
import TabNav from '../../components/TabNav'
import { categories } from '../../data/mock'
import { getProducts } from '../../services/products'
import type { Product } from '../../types/market'

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([])
  useDidShow(() => { getProducts().then(setProducts).catch(error => Taro.showToast({ title: error.message, icon: 'none' })) })

  return <View className='page page--with-nav'>
    <View className='home-hero'>
      <View className='home-hero__top'><View><Text className='eyebrow'>CAMPUSMARKET · 校园好物循环</Text><Text className='home-hero__title'>让闲置，遇见下一个主人。</Text></View><Text className='home-hero__leaf'>✳</Text></View>
      <View className='search-box' onClick={() => Taro.reLaunch({ url: '/pages/categories/index' })}><Text>⌕</Text><Input disabled placeholder='搜一搜，发现校园好物' /></View>
      <View className='home-hero__footer'><Text>📍 北区校区及周边</Text><Text>同校交易 · 安心面交</Text></View>
    </View>

    <View className='content-pad'>
      <SectionTitle title='逛逛分类' subtitle='找到你需要的' action='全部分类' onAction={() => Taro.reLaunch({ url: '/pages/categories/index' })} />
      <ScrollView scrollX className='category-scroll'><View className='category-row'>{categories.map(category => <View key={category.id} className='category-tile' onClick={() => Taro.reLaunch({ url: `/pages/categories/index?category=${category.id}` })}><Text className='category-tile__emoji'>{category.emoji}</Text><Text>{category.name}</Text></View>)}</View></ScrollView>

      <View className='home-promo' onClick={() => Taro.reLaunch({ url: '/pages/publish/index' })}><View><Text className='home-promo__tag'>毕业季 · 闲置计划</Text><Text className='home-promo__title'>好东西，值得被看见</Text><Text className='home-promo__desc'>发布你的闲置，让它继续发光</Text></View><Text className='home-promo__arrow'>↗</Text></View>

      <SectionTitle title='最新上架' subtitle='校园里的新鲜好物' action='查看更多' onAction={() => Taro.reLaunch({ url: '/pages/categories/index' })} />
      <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View>
    </View>
    <TabNav active='index' />
  </View>
}
