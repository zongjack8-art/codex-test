import { Image, Text } from '@tarojs/components'

export default function Avatar({ value, className }: { value: string; className: string }) {
  return /^(cloud|https?|wxfile|file):\/\//.test(value) || value.startsWith('blob:') || value.startsWith('/')
    ? <Image className={className} src={value} mode='aspectFill' />
    : <Text className={className}>{value || '同'}</Text>
}
