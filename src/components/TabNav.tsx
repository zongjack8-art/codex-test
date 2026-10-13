import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

const tabs = [
  { page: 'index', label: '首页', icon: '⌂', url: '/pages/index/index' },
  { page: 'categories', label: '分类', icon: '▦', url: '/pages/categories/index' },
  { page: 'publish', label: '发布', icon: '+', url: '/pages/publish/index' },
  { page: 'favorites', label: '收藏', icon: '♡', url: '/pages/favorites/index' },
  { page: 'profile', label: '我的', icon: '◉', url: '/pages/profile/index' }
]

export default function TabNav({ active }: { active: string }) {
  return <View className='tab-nav'>
    {tabs.map(tab => <View key={tab.page} className={`tab-nav__item ${active === tab.page ? 'is-active' : ''} ${tab.page === 'publish' ? 'tab-nav__publish' : ''}`} onClick={() => active !== tab.page && Taro.reLaunch({ url: tab.url })}>
      <Text className='tab-nav__icon'>{tab.icon}</Text>
      <Text className='tab-nav__label'>{tab.label}</Text>
    </View>)}
  </View>
}
