import { Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import homeHero from '../../assets/home-campus-hero.png'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import ProductCard from '../../components/ProductCard'
import ProductGridSkeleton from '../../components/ProductGridSkeleton'
import SearchBar from '../../components/SearchBar'
import SectionTitle from '../../components/SectionTitle'
import TabNav from '../../components/TabNav'
import { campusConfig } from '../../config/campus'
import { isH5CloudFallback } from '../../services/mode'
import { getProducts } from '../../services/products'
import type { Product } from '../../types/market'

const goExplore = (query = '') => Taro.reLaunch({ url: `/pages/categories/index${query}` })

const homeCategories = [
  { id: 'books', title: '教材', subtitle: '课本资料', icon: 'book', tone: 0 },
  { id: 'digital', title: '数码', subtitle: '手机电脑', icon: 'laptop', tone: 1 },
  { id: 'daily', title: '宿舍好物', subtitle: '桌椅收纳', icon: 'bed', tone: 2 },
  { id: 'fashion', title: '衣物', subtitle: '潮流穿搭', icon: 'shirt', tone: 0 },
  { id: 'sports', title: '代步', subtitle: '单车滑板', icon: 'bike', tone: 3 },
  { id: 'other', title: '其他', subtitle: '更多闲置', icon: 'more', tone: 2 }
] as const

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const load = () => {
    setLoadError('')
    setLoading(true)
    getProducts().then(setProducts).catch(() => setLoadError('请检查网络或云环境后重试')).finally(() => setLoading(false))
  }
  useDidShow(load)

  return <View className='page page--with-nav home-page'>
    <View className='home-hero'>
      <Image className='home-hero__visual' src={homeHero} mode='aspectFill' />
      <View className='home-hero__veil' />
      <View className='home-brand'>
        <View className='home-brand__mark'><Text>C</Text></View>
        <View><Text className='home-brand__name'>{campusConfig.brandName}</Text><Text className='home-brand__sub'>{campusConfig.brandChineseName}</Text></View>
        <View className='home-brand__campus'><Icon name='pin' size='sm' /><Text>{campusConfig.schoolName}</Text></View>
      </View>
      <View className='home-hero__copy'><Text className='home-hero__eyebrow'>{campusConfig.schoolSlogan}</Text><Text className='home-hero__title'>发现同学的好东西，<Text>让闲置继续发光。</Text></Text><Text className='home-hero__desc'>在熟悉的校园里，买卖都更轻松。</Text></View>
      <SearchBar className='home-hero__search' onClick={() => goExplore()} />
      <View className='home-hero__promise'><Icon name='shield' size='sm' /><Text>同校面交 · 当面验货更安心</Text></View>
    </View>

    <View className='content-pad'>
      {isH5CloudFallback() && <Text className='mode-banner'>H5 当前使用本机演示数据。</Text>}

      <View className='category-grid category-grid--reference'>
        {homeCategories.map(item => <View key={item.id} className='category-tile category-tile--reference' onClick={() => goExplore(`?category=${item.id}`)}>
          <View className={`category-tile__icon category-tile__icon--${item.tone}`}><Icon name={item.icon} size='lg' /></View>
          <View className='category-tile__copy'><Text className='category-tile__title'>{item.title}</Text><Text className='category-tile__subtitle'>{item.subtitle}</Text></View>
        </View>)}
      </View>

      <SectionTitle title='推荐好物' action='查看更多' onAction={() => goExplore()} />
      {loading ? <ProductGridSkeleton /> : loadError ? <EmptyState kind='error' title='暂时没能加载好物' description={loadError} action='重试' onAction={load} /> : products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View> : <EmptyState kind='search' title='还没有上架的好物' description='来发布第一件闲置吧' action='去发布' onAction={() => Taro.reLaunch({ url: '/pages/publish/index' })} />}
      <View className='home-safety'><Icon name='shield' size='md' /><View><Text>安心交易小提示</Text><Text>约在校内公共区域，见面验货后再付款</Text></View></View>
    </View>
    <TabNav active='index' />
  </View>
}
