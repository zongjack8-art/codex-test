import { Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import EmptyState from '../../components/EmptyState'
import { deleteProduct, getMyProducts, setProductStatus } from '../../services/products'
import type { Product, ProductStatus } from '../../types/market'

export default function MyListingsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const load = () => getMyProducts().then(setProducts).catch(error => Taro.showToast({ title: error.message, icon: 'none' }))
  useDidShow(load)

  const update = async (product: Product, status: ProductStatus) => {
    try { await setProductStatus(product.id, status); await load(); Taro.showToast({ title: '状态已更新', icon: 'none' }) }
    catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  }
  const remove = async (product: Product) => {
    const result = await Taro.showModal({ title: '删除商品', content: `确定删除「${product.title}」吗？` })
    if (!result.confirm) return
    try { await deleteProduct(product.id); await load(); Taro.showToast({ title: '已删除', icon: 'none' }) }
    catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  }

  return <View className='page'><View className='page-heading'><Text className='eyebrow'>MY LISTINGS</Text><Text className='page-heading__title'>我的发布</Text><Text className='page-heading__desc'>每一件闲置，都值得被好好记录。</Text></View><View className='content-pad'><View className='results-bar'><Text>共发布 {products.length} 件商品</Text></View>{products.length ? products.map(product => <View className='listing-card' key={product.id}><View className='listing-card__main' onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` })}><View className='listing-card__visual' style={{ backgroundColor: product.coverColor }}>{product.images[0] ? <Image src={product.images[0]} mode='aspectFill' /> : <Text>{product.coverEmoji}</Text>}</View><View className='listing-card__info'><Text className='listing-card__title'>{product.title}</Text><Text className='listing-card__status'>{product.status === 'sold' ? '已售出' : product.status === 'offline' ? '已下架' : '出售中'} · {product.campus}</Text><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text></View></View><View className='listing-card__actions'><Text onClick={() => Taro.navigateTo({ url: `/pages/publish/index?id=${encodeURIComponent(product.id)}` })}>编辑</Text>{product.status === 'selling' && <Text onClick={() => update(product, 'sold')}>标记售出</Text>}{product.status !== 'offline' && <Text onClick={() => update(product, 'offline')}>下架</Text>}{product.status !== 'selling' && <Text onClick={() => update(product, 'selling')}>重新上架</Text>}<Text onClick={() => remove(product)}>删除</Text></View></View>) : <View><EmptyState icon='📦' title='还没有发布商品' description='发布第一件闲置，开启你的校园好物循环' /><View className='button-primary empty-action' onClick={() => Taro.reLaunch({ url: '/pages/publish/index' })}>去发布</View></View>}</View></View>
}
