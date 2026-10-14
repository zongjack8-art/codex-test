import { Text, View } from '@tarojs/components'
import AppButton from './AppButton'
import Icon, { type IconName } from './Icon'

const kindIcons: Record<'search' | 'favorites' | 'listings' | 'sold' | 'error' | 'messages', IconName> = { search: 'search', favorites: 'heart', listings: 'package', sold: 'check', error: 'shield', messages: 'message' }

export default function EmptyState({ kind = 'listings', title, description, action, onAction }: { kind?: keyof typeof kindIcons; title: string; description?: string; action?: string; onAction?: () => void }) {
  return <View className='empty-state'>
    <View className='empty-state__art'><Icon name={kindIcons[kind]} size='lg' /></View>
    <Text className='empty-state__title'>{title}</Text>
    {description && <Text className='empty-state__description'>{description}</Text>}
    {action && onAction && <AppButton variant='secondary' onClick={onAction} className='empty-state__action'>{action}</AppButton>}
  </View>
}
