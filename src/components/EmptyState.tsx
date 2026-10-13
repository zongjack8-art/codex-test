import { Text, View } from '@tarojs/components'

export default function EmptyState({ icon = '📦', title, description }: { icon?: string; title: string; description?: string }) {
  return <View className='empty-state'><Text className='empty-state__icon'>{icon}</Text><Text className='empty-state__title'>{title}</Text>{description && <Text className='empty-state__description'>{description}</Text>}</View>
}
