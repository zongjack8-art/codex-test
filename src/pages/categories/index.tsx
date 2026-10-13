import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import ProductCard from '../../components/ProductCard'
import TabNav from '../../components/TabNav'
import { categories } from '../../data/mock'
import { getProducts } from '../../services/products'
import type { CategoryId, Product, ProductFilters } from '../../types/market'

export default function CategoriesPage() {
  const routeCategory = getCurrentInstance().router?.params?.category
  const initialCategory = categories.some(item => item.id === routeCategory) ? routeCategory as CategoryId : 'all'
  const [category, setCategory] = useState<CategoryId | 'all'>(initialCategory)
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<ProductFilters['sort']>('newest')
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

  return <View className='page page--with-nav'>
    <View className='page-heading'><Text className='eyebrow'>DISCOVER</Text><Text className='page-heading__title'>发现校园好物</Text><Text className='page-heading__desc'>每件闲置，都有新的故事。</Text></View>
    <View className='content-pad'>
      <View className='search-box search-box--plain'><Text>⌕</Text><Input value={keyword} onInput={event => setKeyword(event.detail.value)} placeholder='搜索商品名称或关键词' /><Text className='search-box__clear' onClick={() => setKeyword('')}>{keyword ? '×' : ''}</Text></View>
      <ScrollView scrollX className='filter-scroll'><View className='filter-chips'><Text className={`chip ${category === 'all' ? 'chip--active' : ''}`} onClick={() => setCategory('all')}>全部</Text>{categories.map(item => <Text key={item.id} className={`chip ${category === item.id ? 'chip--active' : ''}`} onClick={() => setCategory(item.id)}>{item.emoji} {item.name}</Text>)}</View></ScrollView>
      <View className='results-bar'><Text>{loading ? '正在寻找...' : `共 ${products.length} 件好物`}</Text><View className='sort-actions'><Text className={sort === 'newest' ? 'is-selected' : ''} onClick={() => setSort('newest')}>最新</Text><Text className={sort === 'priceAsc' ? 'is-selected' : ''} onClick={() => setSort('priceAsc')}>价格↑</Text><Text className={sort === 'priceDesc' ? 'is-selected' : ''} onClick={() => setSort('priceDesc')}>价格↓</Text></View></View>
      {products.length ? <View className='product-grid'>{products.map(product => <ProductCard key={product.id} product={product} />)}</View> : !loading && <EmptyState icon='🔎' title='暂时没有找到好物' description='换个关键词或分类试试看' />}
    </View>
    <TabNav active='categories' />
  </View>
}
