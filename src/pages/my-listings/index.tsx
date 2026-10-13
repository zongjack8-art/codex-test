import { Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import EmptyState from '../../components/EmptyState'
import { deleteProduct, getMyProducts, setProductStatus } from '../../services/products'
import type { Product, ProductStatus } from '../../types/market'

const filters: { label: string; status: ProductStatus | 'all' }[] = [
  { label: '全部', status: 'all' },
  { label: '出售中', status: 'selling' },
  { label: '已售出', status: 'sold' },
  { label: '已下架', status: 'offline' }
]

export default function MyListingsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [statusFilter, setStatusFilter] = useState<ProductStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const load = () => {
    setLoading(true)
    return getMyProducts().then(setProducts).catch(error => Taro.showToast({ title: error.message, icon: 'none' })).finally(() => setLoading(false))
  }
  useDidShow(load)

  const update = async (product: Product, status: ProductStatus) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPendingId(product.id)
    try {
      if (status !== 'selling') {
        const result = await Taro.showModal({ title: status === 'sold' ? '确认售出' : '确认下架', content: `确定将「${product.title}」${status === 'sold' ? '标记为已售出' : '下架'}吗？` })
        if (!result.confirm) return
      }
      await setProductStatus(product.id, status)
      await load()
      Taro.showToast({ title: '状态已更新', icon: 'none' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { pendingRef.current = false; setPendingId(null) }
  }

  const remove = async (product: Product) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPendingId(product.id)
    try {
      const result = await Taro.showModal({ title: '删除商品', content: `确定删除「${product.title}」吗？` })
      if (!result.confirm) return
      await deleteProduct(product.id)
      await load()
      Taro.showToast({ title: '已删除', icon: 'none' })
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { pendingRef.current = false; setPendingId(null) }
  }

  const visible = statusFilter === 'all' ? products : products.filter(product => product.status === statusFilter)

  return <View className='page'>
    <View className='page-heading'><Text className='eyebrow'>MY LISTINGS</Text><Text className='page-heading__title'>我的发布</Text><Text className='page-heading__desc'>每一件闲置，都值得被好好记录。</Text></View>
    <View className='content-pad'>
      <View className='listing-filters'>{filters.map(filter => <Text key={filter.status} className={`chip ${statusFilter === filter.status ? 'chip--active' : ''}`} onClick={() => setStatusFilter(filter.status)}>{filter.label}</Text>)}</View>
      <View className='results-bar'><Text>{loading ? '正在加载...' : statusFilter === 'all' ? `共发布 ${products.length} 件商品` : `${filters.find(filter => filter.status === statusFilter)?.label} · ${visible.length} 件`}</Text></View>
      {!loading && (visible.length ? visible.map(product => <View className={`listing-card ${pendingId === product.id ? 'listing-card--pending' : ''}`} key={product.id}>
        <View className='listing-card__main' onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` })}>
          <View className='listing-card__visual' style={{ backgroundColor: product.coverColor }}>{product.images[0] ? <Image src={product.images[0]} mode='aspectFill' /> : <Text>{product.coverEmoji}</Text>}</View>
          <View className='listing-card__info'><Text className='listing-card__title'>{product.title}</Text><Text className='listing-card__status'>{product.status === 'sold' ? '已售出' : product.status === 'offline' ? '已下架' : '出售中'} · {product.campus}</Text><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text></View>
        </View>
        <View className='listing-card__actions'><Text onClick={() => !pendingRef.current && Taro.navigateTo({ url: `/pages/publish/index?id=${encodeURIComponent(product.id)}` })}>编辑</Text>{product.status === 'selling' && <Text onClick={() => update(product, 'sold')}>标记售出</Text>}{product.status !== 'offline' && <Text onClick={() => update(product, 'offline')}>下架</Text>}{product.status !== 'selling' && <Text onClick={() => update(product, 'selling')}>重新上架</Text>}<Text onClick={() => remove(product)}>删除</Text></View>
      </View>) : <View>
        <EmptyState icon='📦' title={products.length ? '这个状态下还没有商品' : '还没有发布商品'} description={products.length ? '试试切换上方状态查看' : '发布第一件闲置，开启你的校园好物循环'} />
        {products.length ? <View className='button-outline empty-action' onClick={() => setStatusFilter('all')}>查看全部</View> : <View className='button-primary empty-action' onClick={() => Taro.reLaunch({ url: '/pages/publish/index' })}>去发布</View>}
      </View>)}
    </View>
  </View>
}
