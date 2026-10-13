import { Text, View } from '@tarojs/components'
import Icon from './Icon'

export default function SectionTitle({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return <View className='section-title'><View><Text className='section-title__main'>{title}</Text>{subtitle && <Text className='section-title__sub'>{subtitle}</Text>}</View>{action && <View className='section-title__action' onClick={onAction}><Text>{action}</Text><Icon name='chevron' size='sm' /></View>}</View>
}
