import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import ProductCard from '../../components/ProductCard'
import ProductGridSkeleton from '../../components/ProductGridSkeleton'
import SearchBar from '../../components/SearchBar'
import TabNav from '../../components/TabNav'
import { campusConfig } from '../../config/campus'
import { categories } from '../../data/mock'
import { getProducts } from '../../services/products'
import type { CategoryId, Product, ProductFilters } from '../../types/market'

const sorts: { label: string; value: NonNullable<ProductFilters['sort']> }[] = [
  { label: '最新发布', value: 'newest' },
  { label: '价格从低到高', value: 'priceAsc' },
  { label: '价格从高到低', value: 'priceDesc' }
]
const prices = [
  { label: '不限', minPrice: undefined, maxPrice: undefined },
  { label: '¥0–20', minPrice: 0, maxPrice: 20 },
  { label: '¥20–50', minPrice: 20, maxPrice: 50 },
  { label: '¥50–100', minPrice: 50, maxPrice: 100 },
  { label: '¥100–300', minPrice: 100, maxPrice: 300 },
  { label: '¥300 以上', minPrice: 300, maxPrice: undefined }
] as const

export default function CategoriesPage() {
  const params = getCurrentInstance().router?.params
  const routeCategory = params?.category
  const initialCategory = categories.some(item => item.id === routeCategory) ? routeCategory as CategoryId : 'all'
  const [category, setCategory] = useState<CategoryId | 'all'>(initialCategory)
  const [keyword, setKeyword] = useState(() => { try { return decodeURIComponent(params?.keyword || '') } catch { return params?.keyword || '' } })
  const [sort, setSort] = useState<NonNullable<ProductFilters['sort']>>('newest')
  const [priceIndex, setPriceIndex] = useState(0)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(-1)

  useDidShow(() => setRefresh(value => value + 1))
  useEffect(() => {
    if (refresh < 0) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    const timer = setTimeout(() => {
      getProducts({ category, keyword, sort, minPrice: prices[priceIndex].minPrice, maxPrice: prices[priceIndex].maxPrice })
        .then(items => { if (!cancelled) setProducts(items) })
        .catch(() => { if (!cancelled) setLoadError('请检查网络或云环境后重试') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, keyword ? 250 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [category, keyword, sort, priceIndex, refresh])

  const clearFilters = () => { setKeyword(''); setCategory('all'); setPriceIndex(0); setSort('newest') }

  return <View className='page page--with-nav categories-page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>EXPLORE CAMPUS</Text><Text className='page-heading__title'>发现{campusConfig.schoolShortName}好物</Text><Text className='page-heading__desc'>从一本书到一辆车，遇见刚好需要的。</Text></View>
    <View className='content-pad explore-content'>
      <SearchBar value={keyword} onInput={setKeyword} />
      <View className='filter-heading'><Icon name='sliders' size='sm' /><Text>按分类逛</Text></View>
      <ScrollView scrollX className='filter-scroll'><View className='filter-chips'><Text className={`chip ${category === 'all' ? 'chip--active' : ''}`} onClick={() => setCategory('all')}>全部</Text>{categories.map(item => <Text key={item.id} className={`chip ${category === item.id ? 'chip--active' : ''}`} onClick={() => setCategory(item.id)}>{item.name}</Text>)}</View></ScrollView>
      <View className='filter-heading'><Text>价格区间</Text></View>
      <ScrollView scrollX className='filter-scroll'><View className='filter-chips'>{prices.map((item, index) => <Text key={item.label} className={`chip ${priceIndex === index ? 'chip--active' : ''}`} onClick={() => setPriceIndex(index)}>{item.label}</Text>)}</View></ScrollView>
      <View className='filter-heading'><Text>排序方式</Text></View>
      <ScrollView scrollX className='filter-scroll'><View className='filter-chips'>{sorts.map(item => <Text key={item.value} className={`chip ${sort === item.value ? 'chip--active' : ''}`} onClick={() => setSort(item.value)}>{item.label}</Text>)}</View></ScrollView>
      <View className='results-bar results-bar--single'><Text>{loading ? '正在发现好物…' : `找到 ${products.length} 件好物`}</Text></View>
      {loading ? <ProductGridSkeleton /> : loadError ? <EmptyState kind='error' title='搜索暂时不可用' description={loadError} action='重试' onAction={() => setRefresh(value => value + 1)} /> : products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View> : <EmptyState kind='search' title='没有找到符合条件的好物' description='换个关键词、分类或价格，再逛逛看' action='清除筛选' onAction={clearFilters} />}
    </View>
    <TabNav active='categories' />
  </View>
}
