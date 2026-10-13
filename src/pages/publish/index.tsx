import { Image, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import TabNav from '../../components/TabNav'
import { categories } from '../../data/mock'
import { createProduct } from '../../services/products'
import { uploadImage } from '../../services/upload'
import type { CategoryId } from '../../types/market'

const conditions = ['全新未拆', '九成新', '八成新', '七成新及以下']

export default function PublishPage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [originalPrice, setOriginalPrice] = useState('')
  const [category, setCategory] = useState<CategoryId>('books')
  const [condition, setCondition] = useState('九成新')
  const [campus, setCampus] = useState('北区校区')
  const [images, setImages] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const chooseImages = async () => {
    try {
      const result = await Taro.chooseImage({ count: 3 - images.length, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      setImages(current => [...current, ...result.tempFilePaths].slice(0, 3))
    } catch (error) {
      if ((error as Error).message && !String((error as Error).message).includes('cancel')) Taro.showToast({ title: '选择图片失败', icon: 'none' })
    }
  }

  const submit = async () => {
    if (submitting) return
    if (!title.trim() || title.trim().length < 2) return Taro.showToast({ title: '请填写至少 2 个字的标题', icon: 'none' })
    if (!description.trim()) return Taro.showToast({ title: '请填写商品描述', icon: 'none' })
    if (!Number.isFinite(Number(price)) || Number(price) <= 0) return Taro.showToast({ title: '请输入正确的价格', icon: 'none' })
    if (!campus.trim()) return Taro.showToast({ title: '请填写交易校区', icon: 'none' })

    setSubmitting(true)
    try {
      const uploaded = await Promise.all(images.map(uploadImage))
      await createProduct({ title: title.trim(), description: description.trim(), price: Number(price), originalPrice: originalPrice ? Number(originalPrice) : undefined, category, condition, campus: campus.trim(), images: uploaded })
      Taro.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => Taro.reLaunch({ url: '/pages/my-listings/index' }), 800)
    } catch (error) {
      Taro.showToast({ title: (error as Error).message || '发布失败', icon: 'none' })
    } finally { setSubmitting(false) }
  }

  return <View className='page page--with-nav'>
    <View className='page-heading page-heading--publish'><Text className='eyebrow'>PASS IT ON</Text><Text className='page-heading__title'>发布你的闲置</Text><Text className='page-heading__desc'>让好东西，找到下一个喜欢它的人。</Text></View>
    <View className='content-pad publish-form'>
      <View className='form-card'><Text className='form-label'>商品照片 <Text className='form-label__optional'>最多 3 张</Text></Text><View className='upload-grid'>{images.map((image, index) => <View key={`${image}-${index}`} className='upload-item'><Image src={image} mode='aspectFill' /><Text className='upload-item__remove' onClick={() => setImages(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</Text></View>)}{images.length < 3 && <View className='upload-add' onClick={chooseImages}><Text>＋</Text><Text>添加照片</Text></View>}</View><Text className='form-hint'>清晰的实物图更容易获得关注</Text></View>
      <View className='form-card'><Text className='form-label'>商品信息</Text><Input className='form-input' maxlength={40} value={title} onInput={event => setTitle(event.detail.value)} placeholder='给商品起个吸引人的标题' /><Textarea className='form-textarea' maxlength={500} value={description} onInput={event => setDescription(event.detail.value)} placeholder='描述新旧程度、使用感受及交易方式...' /></View>
      <View className='form-card'><Text className='form-label'>定价与分类</Text><View className='form-row'><Text>转让价格</Text><View className='form-row__input'><Text>¥</Text><Input type='digit' value={price} onInput={event => setPrice(event.detail.value)} placeholder='0.00' /></View></View><View className='form-row'><Text>购入原价 <Text className='form-label__optional'>选填</Text></Text><View className='form-row__input'><Text>¥</Text><Input type='digit' value={originalPrice} onInput={event => setOriginalPrice(event.detail.value)} placeholder='0.00' /></View></View><Picker mode='selector' range={categories.map(item => item.name)} value={categories.findIndex(item => item.id === category)} onChange={event => setCategory(categories[Number(event.detail.value)].id)}><View className='form-row'><Text>商品分类</Text><Text className='form-row__value'>{categories.find(item => item.id === category)?.name} ›</Text></View></Picker><Picker mode='selector' range={conditions} value={conditions.indexOf(condition)} onChange={event => setCondition(conditions[Number(event.detail.value)])}><View className='form-row'><Text>新旧程度</Text><Text className='form-row__value'>{condition} ›</Text></View></Picker></View>
      <View className='form-card'><Text className='form-label'>交易地点</Text><View className='form-row'><Text>所在校区</Text><Input className='form-campus' value={campus} onInput={event => setCampus(event.detail.value)} placeholder='例如：北区校区' /></View><Text className='form-hint'>建议选择校内公共地点当面交易</Text></View>
      <View className='button-primary button-primary--wide' onClick={submit}>{submitting ? '发布中...' : '立即发布'}</View>
      <Text className='publish-footnote'>发布即代表你同意遵守校园交易规范</Text>
    </View>
    <TabNav active='publish' />
  </View>
}
