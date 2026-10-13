import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import Icon, { type IconName } from './Icon'

const tabs: { page: string; label: string; icon: IconName; url: string }[] = [
  { page: 'index', label: '首页', icon: 'home', url: '/pages/index/index' },
  { page: 'categories', label: '分类', icon: 'grid', url: '/pages/categories/index' },
  { page: 'publish', label: '发布', icon: 'plus', url: '/pages/publish/index' },
  { page: 'favorites', label: '收藏', icon: 'heart', url: '/pages/favorites/index' },
  { page: 'profile', label: '我的', icon: 'user', url: '/pages/profile/index' }
]

export default function TabNav({ active }: { active: string }) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  useEffect(() => {
    if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return
    const onHeight = (event: { height: number }) => setKeyboardOpen(event.height > 0)
    Taro.onKeyboardHeightChange(onHeight)
    return () => Taro.offKeyboardHeightChange(onHeight)
  }, [])
  if (keyboardOpen) return null
  return <View className='tab-nav'>
    {tabs.map(tab => <View key={tab.page} className={`tab-nav__item ${active === tab.page ? 'is-active' : ''} ${tab.page === 'publish' ? 'tab-nav__publish' : ''}`} onClick={() => active !== tab.page && Taro.reLaunch({ url: tab.url })}>
      <View className='tab-nav__icon-wrap'><Icon name={tab.icon} size='md' /></View>
      <Text className='tab-nav__label'>{tab.label}</Text>
    </View>)}
  </View>
}
