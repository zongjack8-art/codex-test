import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
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

const categoryLabels: Record<string, string> = {
  books: '教材',
  digital: '数码',
  daily: '宿舍好物',
  sports: '代步',
  fashion: '衣物',
  other: '其他'
}

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = () => {
    setLoadError('')
    setLoading(true)
    getProducts()
      .then(setProducts)
      .catch(() => setLoadError('请检查网络或云环境后重试'))
      .finally(() => setLoading(false))
  }

  useDidShow(load)

  return <View className='page page--with-nav home-page home-page--v2'>
    <View className='home-hero-v2'>
      <View className='home-brand home-brand--v2'>
        <View className='home-brand__mark'><Text>C</Text></View>
        <View className='home-brand__text'>
          <Text className='home-brand__name'>{campusConfig.brandName}</Text>
          <Text className='home-brand__sub'>{campusConfig.brandChineseName}</Text>
        </View>
        <View className='home-brand__campus'><Icon name='pin' size='sm' /><Text>{campusConfig.schoolShortName}</Text></View>
      </View>

      <View className='home-hero-v2__copy'>
        <Text className='home-hero-v2__eyebrow'>CAMPUS SECOND-HAND MARKET</Text>
        <Text className='home-hero-v2__title'>校园二手好物集市</Text>
        <Text className='home-hero-v2__desc'>让闲置流转，让好物延续价值</Text>
      </View>

      <View className='home-hero-v2__art' aria-hidden>
        <View className='home-hero-v2__sun' />
        <View className='home-hero-v2__cloud home-hero-v2__cloud--1' />
        <View className='home-hero-v2__cloud home-hero-v2__cloud--2' />
        <View className='home-hero-v2__building'>
          <View className='home-hero-v2__building-top' />
          <View className='home-hero-v2__windows'>
            <View /><View /><View /><View /><View /><View />
          </View>
        </View>
        <View className='home-hero-v2__tree home-hero-v2__tree--1' />
        <View className='home-hero-v2__tree home-hero-v2__tree--2' />
        <View className='home-hero-v2__student'>
          <View className='home-hero-v2__student-head' />
          <View className='home-hero-v2__student-hair' />
          <View className='home-hero-v2__student-body' />
          <View className='home-hero-v2__student-bag' />
        </View>
      </View>

      <SearchBar
        className='home-hero-v2__search'
        placeholder='搜索教材、数码、自行车…'
        actionLabel='搜索'
        onClick={() => goExplore()}
      />
    </View>

    <View className='content-pad home-content-v2'>
      {isH5CloudFallback() && <Text className='mode-banner'>H5 当前使用本机演示数据。</Text>}

      <View className='home-category-card'>
        <SectionTitle title='校园分类' subtitle='从校园日常开始发现' action='全部' onAction={() => goExplore()} />
        <View className='category-grid category-grid--v2'>
          {categories.map((item, index) => <View key={item.id} className='category-tile category-tile--v2' onClick={() => goExplore(`?category=${item.id}`)}>
            <View className={`category-tile__icon category-tile__icon--${index % 4}`}><Icon name={item.icon} size='lg' /></View>
            <Text>{categoryLabels[item.id] || item.shortName}</Text>
          </View>)}
          <View className='category-tile category-tile--v2' onClick={() => goExplore('?keyword=%E6%AF%95%E4%B8%9A')}>
            <View className='category-tile__icon category-tile__icon--3'><Icon name='spark' size='lg' /></View><Text>毕业季</Text>
          </View>
          <View className='category-tile category-tile--v2' onClick={() => goExplore()}>
            <View className='category-tile__icon category-tile__icon--0'><Icon name='grid' size='lg' /></View><Text>全部好物</Text>
          </View>
        </View>
      </View>

      <View className='feature-card feature-card--v2' onClick={() => goExplore('?keyword=%E6%AF%95%E4%B8%9A')}>
        <View className='feature-card__content'>
          <Text className='feature-card__eyebrow'>GRADUATION SEASON</Text>
          <Text className='feature-card__title'>{campusConfig.schoolShortName}毕业季 · 好物接力</Text>
          <Text className='feature-card__desc'>带不走的心爱物品，留给下一位同学</Text>
          <View className='feature-card__link'><Text>去看看</Text><Icon name='arrow' size='sm' /></View>
        </View>
        <View className='feature-card__art'><View className='feature-card__art-circle'><Icon name='package' size='lg' /></View><View className='feature-card__art-dot' /></View>
      </View>

      <SectionTitle title='推荐好物' subtitle='同校同学刚刚上架' action='查看更多' onAction={() => goExplore()} />
      {loading
        ? <ProductGridSkeleton />
        : loadError
          ? <EmptyState kind='error' title='暂时没能加载好物' description={loadError} action='重试' onAction={load} />
          : products.length
            ? <View className='product-grid product-grid--home-v2'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View>
            : <EmptyState kind='search' title='还没有上架的好物' description='来发布第一件闲置吧' action='去发布' onAction={() => Taro.reLaunch({ url: '/pages/publish/index' })} />}

      <View className='home-safety home-safety--v2'><Icon name='shield' size='md' /><View><Text>安心交易小提示</Text><Text>约在校内公共区域，见面验货后再付款</Text></View></View>
    </View>

    <TabNav active='index' />
  </View>
}
