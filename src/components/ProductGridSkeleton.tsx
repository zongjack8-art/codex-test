import { View } from '@tarojs/components'

export default function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return <View className='product-grid'>{Array.from({ length: count }, (_, index) => <View key={index} className='skeleton-card'><View className='skeleton-card__image' /><View className='skeleton-card__line' /><View className='skeleton-card__line skeleton-card__line--short' /><View className='skeleton-card__price' /></View>)}</View>
}
