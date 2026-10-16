import { Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { useAdminNotifications } from '../hooks/useAdminNotifications'
import { getUnreadMessageCount } from '../services/chat'
import { getOrderUnreadSummary } from '../services/orders'
import { unreadCountLabel } from '../utils/orders'
import { createVisiblePoller } from '../utils/visiblePoller'
import Icon, { type IconName } from './Icon'

const tabs: { page: string; label: string; icon: IconName; url: string }[] = [
  { page: 'index', label: '首页', icon: 'home', url: '/pages/index/index' },
  { page: 'categories', label: '分类', icon: 'grid', url: '/pages/categories/index' },
  { page: 'publish', label: '发布', icon: 'plus', url: '/pages/publish/index' },
  { page: 'messages', label: '消息', icon: 'message', url: '/pages/messages/index' },
  { page: 'profile', label: '我的', icon: 'user', url: '/pages/profile/index' }
]

export default function TabNav({ active, unreadCount, orderUnreadCount, adminPendingReports }: { active: string; unreadCount?: number; orderUnreadCount?: number; adminPendingReports?: number }) {
  const adminNotifications = useAdminNotifications(adminPendingReports === undefined)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [loadedUnread, setLoadedUnread] = useState(0)
  const [loadedOrderUnread, setLoadedOrderUnread] = useState(0)
  const visible = useRef(true)
  const messagePoller = useRef<ReturnType<typeof createVisiblePoller> | null>(null)
  const orderPoller = useRef<ReturnType<typeof createVisiblePoller> | null>(null)
  if (!messagePoller.current) messagePoller.current = createVisiblePoller(async isCurrent => {
    try {
      const count = await getUnreadMessageCount()
      if (isCurrent()) setLoadedUnread(count)
    } catch { /* Preserve the last successful count until the next poll. */ }
  })
  if (!orderPoller.current) orderPoller.current = createVisiblePoller(async isCurrent => {
    try {
      const summary = await getOrderUnreadSummary()
      if (isCurrent()) setLoadedOrderUnread(summary.total)
    } catch { /* Preserve the last successful count until the next poll. */ }
  }, 5000)
  useDidShow(() => { visible.current = true; if (unreadCount === undefined) messagePoller.current?.start() })
  useDidHide(() => { visible.current = false; messagePoller.current?.stop() })
  useDidShow(() => { if (orderUnreadCount === undefined) orderPoller.current?.start() })
  useDidHide(() => { orderPoller.current?.stop() })
  useEffect(() => {
    if (unreadCount === undefined && visible.current) messagePoller.current?.start()
    else messagePoller.current?.stop()
    return () => messagePoller.current?.stop()
  }, [active, unreadCount])
  useEffect(() => {
    if (orderUnreadCount === undefined && visible.current) orderPoller.current?.start()
    else orderPoller.current?.stop()
    return () => orderPoller.current?.stop()
  }, [active, orderUnreadCount])
  useEffect(() => {
    if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return
    const onHeight = (event: { height: number }) => setKeyboardOpen(event.height > 0)
    Taro.onKeyboardHeightChange(onHeight)
    return () => Taro.offKeyboardHeightChange(onHeight)
  }, [])
  if (keyboardOpen) return null
  const profileUnread = (orderUnreadCount ?? loadedOrderUnread) + (adminPendingReports ?? adminNotifications.pendingReports)
  return <View className='tab-nav'>
    {tabs.map(tab => <View key={tab.page} className={`tab-nav__item ${active === tab.page ? 'is-active' : ''} ${tab.page === 'publish' ? 'tab-nav__publish' : ''}`} onClick={() => active !== tab.page && Taro.reLaunch({ url: tab.url })}>
      <View className='tab-nav__icon-wrap'><Icon name={tab.icon} size='md' />{tab.page === 'messages' && (unreadCount ?? loadedUnread) > 0 && <Text className='tab-nav__badge'>{(unreadCount ?? loadedUnread) > 99 ? '99+' : unreadCount ?? loadedUnread}</Text>}{tab.page === 'profile' && profileUnread > 0 && <Text className='tab-nav__badge'>{unreadCountLabel(profileUnread)}</Text>}</View>
      <Text className='tab-nav__label'>{tab.label}</Text>
    </View>)}
  </View>
}
