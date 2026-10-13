import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'

export default function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <View className='form-section'><View className='form-section__heading'><Text>{title}</Text>{hint && <Text>{hint}</Text>}</View>{children}</View>
}
