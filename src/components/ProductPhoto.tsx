import { Image, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Icon from './Icon'

export default function ProductPhoto({ src, className = '', label = '实物照片待补充' }: { src?: string; className?: string; label?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return <View className={`product-photo ${className}`}>
    {src && !failed ? <Image className='product-photo__image' src={src} mode='aspectFill' lazyLoad onError={() => setFailed(true)} /> : <View className='product-photo__fallback'><Icon name='camera' size='lg' /><Text>{label}</Text></View>}
  </View>
}
