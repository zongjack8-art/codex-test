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
import { categories } from '../../data/mock'
import { isH5CloudFallback } from '../../services/mode'
import { getProducts } from '../../services/products'
import type { Product } from '../../types/market'

const goExplore = (query = '') => Taro.reLaunch({ url: `/pages/categories/index${query}` })

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
      <SectionTitle title='逛逛分类' subtitle='从校园日常开始发现' action='全部分类' onAction={() => goExplore()} />
      <View className='category-grid'>
        {categories.map((item, index) => <View key={item.id} className='category-tile' onClick={() => goExplore(`?category=${item.id}`)}><View className={`category-tile__icon category-tile__icon--${index % 4}`}><Icon name={item.icon} size='lg' /></View><Text>{item.shortName}</Text></View>)}
        <View className='category-tile' onClick={() => goExplore('?keyword=%E6%AF%95%E4%B8%9A')}><View className='category-tile__icon category-tile__icon--3'><Icon name='spark' size='lg' /></View><Text>毕业季</Text></View>
        <View className='category-tile' onClick={() => goExplore()}><View className='category-tile__icon category-tile__icon--0'><Icon name='grid' size='lg' /></View><Text>全部好物</Text></View>
      </View>

      <View className='feature-card' onClick={() => goExplore('?keyword=%E6%AF%95%E4%B8%9A')}>
        <View className='feature-card__content'><Text className='feature-card__eyebrow'>GRADUATION SEASON</Text><Text className='feature-card__title'>{campusConfig.schoolShortName}毕业季 · 好物接力</Text><Text className='feature-card__desc'>带不走的心爱物品，留给下一位同学</Text><View className='feature-card__link'><Text>去看看</Text><Icon name='arrow' size='sm' /></View></View>
        <View className='feature-card__art'><View className='feature-card__art-circle'><Icon name='package' size='lg' /></View><View className='feature-card__art-dot' /></View>
      </View>

      <SectionTitle title='刚刚上架' subtitle='发现身边的新鲜闲置' action='查看更多' onAction={() => goExplore()} />
      {loading ? <ProductGridSkeleton /> : loadError ? <EmptyState kind='error' title='暂时没能加载好物' description={loadError} action='重试' onAction={load} /> : products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View> : <EmptyState kind='search' title='还没有上架的好物' description='来发布第一件闲置吧' action='去发布' onAction={() => Taro.reLaunch({ url: '/pages/publish/index' })} />}
      <View className='home-safety'><Icon name='shield' size='md' /><View><Text>安心交易小提示</Text><Text>约在校内公共区域，见面验货后再付款</Text></View></View>
    </View>
    <TabNav active='index' />
  </View>
}
