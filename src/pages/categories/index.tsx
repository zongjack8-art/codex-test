import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import ProductCard from '../../components/ProductCard'
import ProductGridSkeleton from '../../components/ProductGridSkeleton'
import SearchBar from '../../components/SearchBar'
import TabNav from '../../components/TabNav'
import { categories } from '../../data/mock'
import { getProducts } from '../../services/products'
import type { CategoryId, Product, ProductFilters } from '../../types/market'

const sorts: { label: string; value: NonNullable<ProductFilters['sort']> }[] = [
  { label: '最新', value: 'newest' },
  { label: '价格最低', value: 'priceAsc' },
  { label: '价格最高', value: 'priceDesc' }
]

export default function CategoriesPage() {
  const params = getCurrentInstance().router?.params
  const routeCategory = params?.category
  const initialCategory = categories.some(item => item.id === routeCategory) ? routeCategory as CategoryId : 'all'
  const [category, setCategory] = useState<CategoryId | 'all'>(initialCategory)
  const [keyword, setKeyword] = useState(() => { try { return decodeURIComponent(params?.keyword || '') } catch { return params?.keyword || '' } })
  const [sort, setSort] = useState<NonNullable<ProductFilters['sort']>>('newest')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(-1)

  useDidShow(() => setRefresh(value => value + 1))
  useEffect(() => {
    if (refresh < 0) return
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      getProducts({ category, keyword, sort })
        .then(items => { if (!cancelled) setProducts(items) })
        .catch(error => { if (!cancelled) Taro.showToast({ title: error.message, icon: 'none' }) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, keyword ? 250 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [category, keyword, sort, refresh])

  const clearFilters = () => { setKeyword(''); setCategory('all'); setSort('newest') }

  return <View className='page page--with-nav'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>EXPLORE CAMPUS</Text><Text className='page-heading__title'>发现校园好物</Text><Text className='page-heading__desc'>从一本书到一辆车，遇见刚好需要的。</Text></View>
    <View className='content-pad explore-content'>
      <SearchBar value={keyword} onInput={setKeyword} />
      <View className='filter-heading'><Icon name='sliders' size='sm' /><Text>按分类逛</Text></View>
      <ScrollView scrollX className='filter-scroll'><View className='filter-chips'><Text className={`chip ${category === 'all' ? 'chip--active' : ''}`} onClick={() => setCategory('all')}>全部</Text>{categories.map(item => <Text key={item.id} className={`chip ${category === item.id ? 'chip--active' : ''}`} onClick={() => setCategory(item.id)}>{item.name}</Text>)}</View></ScrollView>
      <View className='results-bar'><Text>{loading ? '正在发现好物…' : `找到 ${products.length} 件好物`}</Text><View className='sort-actions'>{sorts.map(item => <Text key={item.value} className={sort === item.value ? 'is-selected' : ''} onClick={() => setSort(item.value)}>{item.label}</Text>)}</View></View>
      {loading ? <ProductGridSkeleton /> : products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View> : <EmptyState kind='search' title='还没找到合适的好物' description='换个关键词或分类，再逛逛看' action='清除筛选' onAction={clearFilters} />}
    </View>
    <TabNav active='categories' />
  </View>
}
