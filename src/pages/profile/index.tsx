import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import AppButton from '../../components/AppButton'
import Avatar from '../../components/Avatar'
import { Badge } from '../../components/Badge'
import Icon, { type IconName } from '../../components/Icon'
import TabNav from '../../components/TabNav'
import { demoUser } from '../../data/mock'
import { getCurrentUser, getSession, loginWithWechat, signOut } from '../../services/auth'
import { getDataMode, isH5CloudFallback } from '../../services/mode'
import { getFavoriteIds, getMyProducts } from '../../services/products'
import type { Session, UserProfile } from '../../types/market'

export default function ProfilePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile>(demoUser)
  const [listingCount, setListingCount] = useState(0)
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [soldCount, setSoldCount] = useState(0)
  useDidShow(() => {
    setSession(getSession())
    getCurrentUser().then(setProfile).catch(error => Taro.showToast({ title: error.message, icon: 'none' }))
    getMyProducts().then(items => { setListingCount(items.length); setSoldCount(items.filter(item => item.status === 'sold').length) }).catch(() => undefined)
    getFavoriteIds().then(ids => setFavoriteCount(ids.length)).catch(() => undefined)
  })

  const login = async () => {
    try { const next = await loginWithWechat(); setSession(next); setProfile(next.user); Taro.showToast({ title: getDataMode() === 'mock' ? '已进入演示模式' : '登录成功', icon: 'none' }) }
    catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  }
  const menu: { icon: IconName; label: string; action: () => void }[] = [
    { icon: 'package', label: '我的发布', action: () => Taro.navigateTo({ url: '/pages/my-listings/index' }) },
    { icon: 'heart', label: '我的收藏', action: () => Taro.reLaunch({ url: '/pages/favorites/index' }) },
    { icon: 'edit', label: '编辑个人资料', action: () => Taro.navigateTo({ url: '/pages/profile/edit' }) },
    { icon: 'shield', label: '交易安全提醒', action: () => Taro.showModal({ title: '安心面交', content: '优先约在图书馆、食堂等校内公共区域；现场核对商品；不要提前转账。', showCancel: false }) },
    { icon: 'spark', label: '关于校园集市', action: () => Taro.showModal({ title: '关于 CampusMarket', content: '让闲置在校园里继续流动。当前为本机演示版本，商品和个人资料不会跨设备同步。', showCancel: false }) }
  ]

  return <View className='page page--with-nav profile-page'>
    <View className='profile-hero'><Text className='page-heading__eyebrow'>MY CAMPUSMARKET</Text><View className='profile-user'><Avatar className='profile-user__avatar' value={profile.avatar} /><View className='profile-user__info'><Text className='profile-user__name'>{profile.nickname || '你好，同学'}</Text><Text className='profile-user__sub'>{profile.school} · {profile.campus}</Text><Badge tone='primary'>{getDataMode() === 'mock' ? '本机演示身份' : '校园用户'}</Badge></View></View></View>
    <View className='content-pad profile-content'>
      <View className='profile-stats'><View onClick={() => Taro.navigateTo({ url: '/pages/my-listings/index' })}><Text>{listingCount}</Text><Text>我的发布</Text></View><View onClick={() => Taro.reLaunch({ url: '/pages/favorites/index' })}><Text>{favoriteCount}</Text><Text>我的收藏</Text></View><View onClick={() => Taro.navigateTo({ url: '/pages/my-listings/index?status=sold' })}><Text>{soldCount}</Text><Text>已售出</Text></View></View>
      {isH5CloudFallback() && <Text className='mode-banner'>H5 当前使用本机演示数据。</Text>}
      <View className='profile-section-heading'><Text>我的校园生活</Text><Text>管理好物，安心交易</Text></View>
      <View className='menu-card'>{menu.map(item => <View key={item.label} className='menu-card__item' onClick={item.action}><View className='menu-card__icon'><Icon name={item.icon} size='md' /></View><Text>{item.label}</Text><Icon name='chevron' size='sm' className='menu-card__arrow' /></View>)}</View>
      <View className='profile-note'><Icon name='shield' size='md' /><View><Text>校园面交，放心一点</Text><Text>见面验货、确认状态，再完成交易</Text></View></View>
      {getDataMode() !== 'cloud' && <AppButton variant='ghost' block onClick={session ? () => { signOut(); setSession(null); setProfile(demoUser); Taro.showToast({ title: '已退出演示身份', icon: 'none' }) } : login}>{session ? '退出当前身份' : (getDataMode() === 'api' ? '微信登录' : '进入演示身份')}</AppButton>}
    </View><TabNav active='profile' />
  </View>
}
