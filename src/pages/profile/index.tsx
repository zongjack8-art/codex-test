import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import TabNav from '../../components/TabNav'
import { demoUser } from '../../data/mock'
import { getSession, loginWithWechat, signOut } from '../../services/auth'
import { getFavoriteIds, getMyProducts } from '../../services/products'
import type { Session } from '../../types/market'

export default function ProfilePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [listingCount, setListingCount] = useState(0)
  const [favoriteCount, setFavoriteCount] = useState(0)
  useDidShow(() => {
    setSession(getSession())
    getMyProducts().then(items => setListingCount(items.length)).catch(() => undefined)
    getFavoriteIds().then(ids => setFavoriteCount(ids.length)).catch(() => undefined)
  })

  const login = async () => {
    try { setSession(await loginWithWechat()); Taro.showToast({ title: __API_BASE_URL__ ? '登录成功' : '已进入演示模式', icon: 'none' }) }
    catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  }

  return <View className='page page--with-nav'><View className='profile-hero'><Text className='eyebrow'>MY CAMPUSMARKET</Text><View className='profile-user'><Text className='profile-user__avatar'>{session?.user.avatar || demoUser.avatar}</Text><View><Text className='profile-user__name'>{session?.user.nickname || '你好，同学'}</Text><Text className='profile-user__sub'>{session?.user.campus || '登录后管理你的校园好物'}</Text></View></View><View className='profile-hero__decoration'>✳</View></View>
    <View className='content-pad profile-content'><View className='profile-stats'><View onClick={() => Taro.navigateTo({ url: '/pages/my-listings/index' })}><Text>{listingCount}</Text><Text>我的发布</Text></View><View onClick={() => Taro.reLaunch({ url: '/pages/favorites/index' })}><Text>{favoriteCount}</Text><Text>我的收藏</Text></View><View><Text>∞</Text><Text>好物循环</Text></View></View>
      <Text className='profile-section-label'>我的服务</Text><View className='menu-card'><View onClick={() => Taro.navigateTo({ url: '/pages/my-listings/index' })}><Text className='menu-card__icon'>▤</Text><Text>我的发布</Text><Text className='menu-card__arrow'>›</Text></View><View onClick={() => Taro.reLaunch({ url: '/pages/favorites/index' })}><Text className='menu-card__icon'>♡</Text><Text>我的收藏</Text><Text className='menu-card__arrow'>›</Text></View><View onClick={() => Taro.showModal({ title: '交易提醒', content: '优先选择校内公共地点面交；现场核对商品；不要提前向陌生人转账。', showCancel: false })}><Text className='menu-card__icon'>◇</Text><Text>交易安全提醒</Text><Text className='menu-card__arrow'>›</Text></View></View>
      <View className='profile-note'><Text>🌿</Text><View><Text>让闲置流动起来</Text><Text>一起让校园生活更轻、更绿色</Text></View></View>
      <View className='button-outline button-outline--wide' onClick={session ? () => { signOut(); setSession(null); Taro.showToast({ title: '已退出', icon: 'none' }) } : login}>{session ? '退出登录' : (__API_BASE_URL__ ? '微信登录' : '进入演示模式')}</View>
    </View><TabNav active='profile' /></View>
}
