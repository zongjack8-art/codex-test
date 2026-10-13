import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { Product } from '../types/market'

export default function ProductCard({ product, compact = false }: { product: Product; compact?: boolean }) {
  return <View className={`product-card ${compact ? 'product-card--compact' : ''}`} onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` })}>
    <View className='product-card__visual' style={{ backgroundColor: product.coverColor }}>
      {product.images[0] ? <Image className='product-card__image' src={product.images[0]} mode='aspectFill' /> : <Text>{product.coverEmoji}</Text>}
    </View>
    <View className='product-card__body'>
      <Text className='product-card__title'>{product.title}</Text>
      <View className='product-card__meta'><Text>{product.condition}</Text><Text>·</Text><Text>{product.campus}</Text></View>
      <View className='product-card__bottom'><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text><Text className='product-card__seller'>{product.seller.avatar} {product.seller.nickname}</Text></View>
    </View>
  </View>
}
