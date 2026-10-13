import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import Avatar from '../../components/Avatar'
import EmptyState from '../../components/EmptyState'
import { getFavoriteIds, getProduct, toggleFavorite } from '../../services/products'
import type { Product } from '../../types/market'

export default function DetailPage() {
  const id = getCurrentInstance().router?.params?.id || ''
  const [product, setProduct] = useState<Product | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const favoriteBusyRef = useRef(false)
  useDidShow(() => {
    setLoading(true)
    getProduct(id)
      .then(setProduct)
      .catch(error => Taro.showToast({ title: error.message, icon: 'none' }))
      .finally(() => setLoading(false))
    getFavoriteIds().then(ids => setFavorite(ids.includes(id))).catch(() => undefined)
  })

  const onFavorite = async () => {
    if (favoriteBusyRef.current) return
    favoriteBusyRef.current = true
    setFavoriteBusy(true)
    try {
      const next = await toggleFavorite(id)
      setFavorite(next)
      Taro.showToast({ title: next ? '已加入收藏' : '已取消收藏', icon: 'none' })
    }
    catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { favoriteBusyRef.current = false; setFavoriteBusy(false) }
  }

  const contact = () => {
    if (product?.status !== 'selling') return Taro.showToast({ title: '该商品当前不可交易', icon: 'none' })
    Taro.showModal({ title: '联系卖家', content: '请通过学校认证的线下渠道联系卖家并当面交易。聊天功能待后端接入后开放。', showCancel: false })
  }

  if (loading) return <View className='page detail-loading'><Text>正在加载商品...</Text></View>
  if (!product) return <View className='page'><EmptyState icon='📦' title='商品不存在或已下架' /><View className='button-outline empty-action' onClick={() => Taro.navigateBack()}>返回逛逛</View></View>
  return <View className='page page--detail'>
    <ScrollView scrollX className='detail-gallery'><View className='detail-gallery__inner'>{product.images.length ? product.images.map((image, index) => <Image key={`${image}-${index}`} src={image} mode='aspectFill' className='detail-gallery__image' onClick={() => Taro.previewImage({ current: image, urls: product.images })} />) : <View className='detail-gallery__placeholder' style={{ backgroundColor: product.coverColor }}><Text>{product.coverEmoji}</Text></View>}</View></ScrollView>
    {product.images.length > 0 && <Text className='detail-gallery__hint'>左右滑动查看 · 点击图片可放大（共 {product.images.length} 张）</Text>}
    <View className='detail-main'><View className='detail-price'><Text className='price'><Text className='price__currency'>¥</Text>{product.price}</Text>{product.originalPrice && <Text className='detail-price__old'>原价 ¥{product.originalPrice}</Text>}<Text className='detail-price__badge'>{product.condition}</Text></View><Text className='detail-title'>{product.title}</Text><Text className='detail-location'>📍 {product.campus} · {product.status === 'sold' ? '已售出' : product.status === 'offline' ? '已下架' : '支持当面交易'}</Text></View>
    <View className='detail-block'><Text className='detail-block__title'>商品描述</Text><Text className='detail-description'>{product.description}</Text></View>
    <View className='detail-block detail-seller'><Avatar className='detail-seller__avatar' value={product.seller.avatar} /><View><Text className='detail-seller__name'>{product.seller.nickname}</Text><Text className='detail-seller__campus'>{product.seller.campus} · 校园卖家</Text></View><Text className='detail-seller__trust'>同校面交</Text></View>
    <View className='detail-tips'>🛡️ 交易提醒：请当面验货，勿提前向陌生人转账。</View>
    <View className='detail-actions'><View className={`detail-actions__favorite ${favorite ? 'is-active' : ''} ${favoriteBusy ? 'is-busy' : ''}`} onClick={onFavorite}><Text>{favorite ? '♥' : '♡'}</Text><Text>{favorite ? '已收藏' : '收藏'}</Text></View><View className={`button-primary detail-actions__contact ${product.status !== 'selling' ? 'button-primary--disabled' : ''}`} onClick={contact}>{product.status === 'selling' ? '联系卖家' : '当前不可交易'}</View></View>
  </View>
}
