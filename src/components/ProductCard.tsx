import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { Product } from '../types/market'
import { formatProductTime } from '../utils/format'
import { Badge } from './Badge'
import Icon from './Icon'
import ProductPhoto from './ProductPhoto'

export default function ProductCard({ product, compact = false, favorite = false, onFavorite }: { product: Product; compact?: boolean; favorite?: boolean; onFavorite?: (product: Product) => void }) {
  return <View className={`product-card ${compact ? 'product-card--compact' : ''}`} onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` })}>
    <ProductPhoto src={product.images[0]} className='product-card__photo' />
    <View className='product-card__floating'><Badge tone='primary'>{product.condition}</Badge></View>
    {onFavorite && <View className={`product-card__favorite ${favorite ? 'is-active' : ''}`} onClick={event => { event.stopPropagation(); onFavorite(product) }}><Icon name='heart' size='sm' /></View>}
    <View className='product-card__body'>
      <Text className='product-card__title'>{product.title}</Text>
      <View className='product-card__price'><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text>{product.originalPrice && <Text className='product-card__old-price'>¥{product.originalPrice}</Text>}</View>
      <View className='product-card__footer'><View className='product-card__location'><Icon name='pin' size='sm' /><Text>{product.campus}</Text></View><Text>{formatProductTime(product.createdAt)}</Text></View>
    </View>
  </View>
}
