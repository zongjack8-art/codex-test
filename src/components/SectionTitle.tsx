import { Text, View } from '@tarojs/components'

export default function SectionTitle({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return <View className='section-title'><View><Text className='section-title__main'>{title}</Text>{subtitle && <Text className='section-title__sub'>{subtitle}</Text>}</View>{action && <Text className='section-title__action' onClick={onAction}>{action} →</Text>}</View>
}
