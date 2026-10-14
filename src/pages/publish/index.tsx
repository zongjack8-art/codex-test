import { Input, Text, Textarea, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import EmptyState from '../../components/EmptyState'
import FormSection from '../../components/FormSection'
import Icon from '../../components/Icon'
import ImageUploader from '../../components/ImageUploader'
import TabNav from '../../components/TabNav'
import { campusConfig, normalizeLegacyLocation } from '../../config/campus'
import { categories } from '../../data/mock'
import { getDataMode, isH5CloudFallback } from '../../services/mode'
import { ensureUserSession } from '../../services/auth'
import { createProduct, getProduct, updateProduct } from '../../services/products'
import { readLocal, writeLocal } from '../../services/storage'
import { discardUploadedImages, uploadImage } from '../../services/upload'
import type { CategoryId } from '../../types/market'

const conditions = ['全新未拆', '九成新', '八成新', '七成新及以下']
const DRAFT_KEY = 'campusmarket.publish-draft.v1'
interface Draft { title: string; description: string; price: string; originalPrice: string; category: CategoryId; condition: string; campus: string }

export default function PublishPage() {
  const editId = getCurrentInstance().router?.params?.id
  const [draft] = useState(() => editId ? null : readLocal<Draft | null>(DRAFT_KEY, null))
  const [title, setTitle] = useState(draft?.title || '')
  const [description, setDescription] = useState(draft?.description || '')
  const [price, setPrice] = useState(draft?.price || '')
  const [originalPrice, setOriginalPrice] = useState(draft?.originalPrice || '')
  const [category, setCategory] = useState<CategoryId>(draft?.category || 'books')
  const [condition, setCondition] = useState(draft?.condition || '九成新')
  const [campus, setCampus] = useState(normalizeLegacyLocation(draft?.campus))
  const [images, setImages] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [editLoading, setEditLoading] = useState(Boolean(editId))
  const [editError, setEditError] = useState('')
  const [uploadProgress, setUploadProgress] = useState('')
  const busyRef = useRef(false)
  const completedRef = useRef(false)

  useEffect(() => {
    if (!editId && !submitting && !completedRef.current) writeLocal(DRAFT_KEY, { title, description, price, originalPrice, category, condition, campus })
  }, [editId, submitting, title, description, price, originalPrice, category, condition, campus])
  const loadEdit = async () => {
    if (!editId) return
    setEditLoading(true)
    setEditError('')
    try {
      const [product, session] = await Promise.all([getProduct(editId), getDataMode() === 'api' ? Promise.resolve(null) : ensureUserSession()])
      if (!product) { setEditError('商品不存在或已被删除'); return }
      if (session && product.seller.id !== session.user.id) { setEditError('只能编辑自己发布的商品'); return }
      if (product.status === 'sold') { setEditError('已售商品不能再编辑'); return }
      setTitle(product.title); setDescription(product.description); setPrice(String(product.price))
      setOriginalPrice(product.originalPrice ? String(product.originalPrice) : '')
      setCategory(product.category); setCondition(product.condition); setCampus(product.campus); setImages(product.images)
    } catch { setEditError('商品暂时无法加载，请检查网络后重试') }
    finally { setEditLoading(false) }
  }
  useDidShow(() => { void loadEdit() })

  const chooseImages = async () => {
    try {
      const result = await Taro.chooseImage({ count: 3 - images.length, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      setImages(current => [...current, ...result.tempFilePaths].slice(0, 3))
    } catch (error) {
      if (!String((error as Error).message).includes('cancel')) Taro.showToast({ title: '选择图片失败，请再试一次', icon: 'none' })
    }
  }

  const submit = async () => {
    if (busyRef.current || (editId && (editLoading || editError))) return
    if (title.trim().length < 2) return Taro.showToast({ title: '商品名称至少写 2 个字', icon: 'none' })
    if (description.trim().length < 5) return Taro.showToast({ title: '商品描述至少写 5 个字', icon: 'none' })
    if (!Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > 100000 || Math.abs(Number(price) * 100 - Math.round(Number(price) * 100)) > 0.00001) return Taro.showToast({ title: '价格需大于 0，最多两位小数', icon: 'none' })
    if (originalPrice && (!Number.isFinite(Number(originalPrice)) || Number(originalPrice) <= 0 || Number(originalPrice) > 100000 || Math.abs(Number(originalPrice) * 100 - Math.round(Number(originalPrice) * 100)) > 0.00001)) return Taro.showToast({ title: '原价最多保留两位小数', icon: 'none' })
    if (!campus.trim()) return Taro.showToast({ title: '请填写方便面交的范围', icon: 'none' })
    if (getDataMode() === 'cloud' && !images.length) return Taro.showToast({ title: '请上传至少一张实物图', icon: 'none' })

    busyRef.current = true
    setSubmitting(true)
    const newlySaved: string[] = []
    try {
      const uploaded: string[] = []
      for (const [index, image] of images.entries()) {
        if (getDataMode() === 'cloud') setUploadProgress(`正在上传第 ${index + 1}/${images.length} 张照片…`)
        const saved = await uploadImage(image)
        uploaded.push(saved)
        if (saved !== image) newlySaved.push(saved)
      }
      const input = { title: title.trim(), description: description.trim(), price: Number(price), originalPrice: originalPrice ? Number(originalPrice) : undefined, category, condition, campus: campus.trim(), images: uploaded }
      if (getDataMode() === 'cloud') setUploadProgress('正在保存商品…')
      if (editId) await updateProduct(editId, input)
      else await createProduct(input)
      if (!editId) { completedRef.current = true; Taro.removeStorageSync(DRAFT_KEY) }
      Taro.showToast({ title: editId ? '修改已保存' : '发布成功', icon: 'success' })
      setTimeout(() => Taro.reLaunch({ url: '/pages/my-listings/index' }), 800)
    } catch (error) {
      await discardUploadedImages(newlySaved).catch(() => undefined)
      Taro.showToast({ title: (error as Error).message || '保存失败，请稍后重试', icon: 'none' })
    } finally { busyRef.current = false; setSubmitting(false); setUploadProgress('') }
  }

  if (editId && editLoading) return <View className='page'><View className='content-pad'><Text className='form-hint'>正在加载商品…</Text></View></View>
  if (editId && editError) return <View className='page'><EmptyState kind='error' title='暂时无法编辑商品' description={editError} action='返回我的发布' onAction={() => Taro.redirectTo({ url: '/pages/my-listings/index' })} /></View>

  return <View className='page page--with-nav'>
    <View className='page-heading page-heading--publish'><Text className='page-heading__eyebrow'>SHARE YOUR FIND</Text><Text className='page-heading__title'>{editId ? '编辑这件好物' : '发布一件闲置'}</Text><Text className='page-heading__desc'>拍张照、写几句，让好东西继续流动。</Text></View>
    <View className='content-pad publish-form'>
      {isH5CloudFallback() && <Text className='mode-banner'>H5 当前使用本机演示数据。</Text>}
      <View className='publish-steps'><View><Icon name='camera' size='sm' /><Text>实物照片</Text></View><Text>→</Text><View><Icon name='edit' size='sm' /><Text>简单介绍</Text></View><Text>→</Text><View><Icon name='check' size='sm' /><Text>发布好物</Text></View></View>
      <FormSection title='先放上照片' hint={getDataMode() === 'cloud' ? '必填 · 最多 3 张' : '选填 · 最多 3 张'}><ImageUploader images={images} onChoose={chooseImages} onRemove={index => setImages(current => current.filter((_, itemIndex) => itemIndex !== index))} />{getDataMode() === 'mock' && Taro.getEnv() === Taro.ENV_TYPE.WEAPP && <Text className='form-hint'>演示模式单张照片不超过 3 MB</Text>}</FormSection>
      <FormSection title='介绍一下它'><View className='form-field'><Text className='form-field__label'>商品名称 <Text>*</Text></Text><Input className='form-input' maxlength={40} value={title} onInput={event => setTitle(event.detail.value)} placeholder='例如：九成新高数教材，附笔记' /></View><View className='form-field'><View className='form-field__label-row'><Text className='form-field__label'>商品描述 <Text>*</Text></Text><Text>{description.length}/500</Text></View><Textarea className='form-textarea' maxlength={500} value={description} onInput={event => setDescription(event.detail.value)} placeholder='说说使用情况、瑕疵和方便面交的时间…' /></View></FormSection>
      <FormSection title='价格与分类'><View className='price-fields'><View className='form-field'><Text className='form-field__label'>转让价 <Text>*</Text></Text><View className='price-input'><Text>¥</Text><Input type='digit' value={price} onInput={event => setPrice(event.detail.value)} placeholder='0.00' /></View></View><View className='form-field'><Text className='form-field__label'>购入价 <Text className='form-field__optional'>选填</Text></Text><View className='price-input price-input--muted'><Text>¥</Text><Input type='digit' value={originalPrice} onInput={event => setOriginalPrice(event.detail.value)} placeholder='0.00' /></View></View></View><Text className='form-field__label form-field__label--spaced'>选择分类</Text><View className='form-choice-grid'>{categories.map(item => <View key={item.id} className={`form-choice ${category === item.id ? 'is-selected' : ''}`} onClick={() => setCategory(item.id)}><Icon name={item.icon} size='sm' /><Text>{item.name}</Text></View>)}</View><Text className='form-field__label form-field__label--spaced'>新旧程度</Text><View className='condition-choices'>{conditions.map(item => <Text key={item} className={`chip ${condition === item ? 'chip--active' : ''}`} onClick={() => setCondition(item)}>{item}</Text>)}</View></FormSection>
      <FormSection title='约个面交地点'><View className='form-field'><Text className='form-field__label'>面交范围 <Text>*</Text></Text><Input className='form-input' maxlength={60} value={campus} onInput={event => setCampus(event.detail.value)} placeholder={`例如：${campusConfig.defaultTradeLocation}`} /></View><Text className='form-hint'>建议填写校内公共区域，具体地点可由双方协商</Text></FormSection>
      <AppButton block onClick={submit} loading={submitting} className='publish-submit'>{editId ? '保存修改' : '发布好物'}</AppButton>
      {uploadProgress && <Text className='publish-footnote'>{uploadProgress}</Text>}
      {!editId && <Text className='publish-footnote'>文字会自动保存在本机；离开后需重新选择照片</Text>}
      <Text className='publish-footnote'>请如实描述商品，守护友好的校园交易氛围</Text>
    </View>
    <TabNav active='publish' />
  </View>
}
