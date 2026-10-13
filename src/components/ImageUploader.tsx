import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from './Icon'

export default function ImageUploader({ images, onChoose, onRemove, max = 3 }: { images: string[]; onChoose: () => void; onRemove: (index: number) => void; max?: number }) {
  return <View className='image-uploader'>
    <View className='image-uploader__grid'>
      {images.map((image, index) => <View key={`${image}-${index}`} className='image-uploader__item'><Image src={image} mode='aspectFill' onClick={() => Taro.previewImage({ current: image, urls: images })} /><View className='image-uploader__remove' onClick={() => onRemove(index)}>×</View></View>)}
      {images.length < max && <View className='image-uploader__add' onClick={onChoose}><Icon name='camera' size='lg' /><Text>添加照片</Text></View>}
    </View>
    <Text className='image-uploader__hint'>上传实物照更容易被看到 · 最多 {max} 张</Text>
  </View>
}
