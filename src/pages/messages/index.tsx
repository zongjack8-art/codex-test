import { Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import Avatar from '../../components/Avatar'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import TabNav from '../../components/TabNav'
import { isH5CloudFallback } from '../../services/mode'
import { getUnreadMessageCount, listConversations } from '../../services/chat'
import type { ChatConversation } from '../../types/market'
import { formatConversationTime } from '../../utils/chatPresentation'
import { createVisiblePoller } from '../../utils/visiblePoller'

export default function MessagesPage() {
  const [items, setItems] = useState<ChatConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const hasLoaded = useRef(false)
  const poller = useRef<ReturnType<typeof createVisiblePoller> | null>(null)
  if (!poller.current) poller.current = createVisiblePoller(async (isCurrent, silent) => {
    const showLoading = !silent && !hasLoaded.current
    if (showLoading) { setLoading(true); setError(false) }
    try {
      const [conversations, count] = await Promise.all([listConversations(), getUnreadMessageCount()])
      if (!isCurrent()) return
      setItems([...conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt)); setUnreadCount(count); setError(false)
      hasLoaded.current = true
    } catch { if (isCurrent() && !hasLoaded.current) setError(true) }
    finally { if (isCurrent() && showLoading) setLoading(false) }
  })
  useDidShow(() => poller.current?.start())
  useDidHide(() => poller.current?.stop())
  useEffect(() => { poller.current?.start(); return () => poller.current?.stop() }, [])

  return <View className='page page--with-nav messages-page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>CAMPUS CONVERSATIONS</Text><Text className='page-heading__title'>消息</Text><Text className='page-heading__desc'>和同学聊聊好物，约个方便的校内地点。</Text></View>
    <View className='content-pad messages-content'>
      {isH5CloudFallback() && <Text className='mode-banner'>H5 当前使用本机演示消息。</Text>}
      {loading ? <View className='listing-skeleton'><View /><View /></View> : error ? <EmptyState kind='error' title='暂时没能加载消息' description='检查网络后再试一次' action='重试' onAction={() => { void poller.current?.refresh(false) }} /> : items.length ? <>
        <View className='messages-summary'><Text>和同学的对话</Text><Text>{unreadCount ? `${unreadCount} 条未读` : '消息已读完'}</Text></View>
        {items.map(item => <View key={item.id} className='conversation-card' onClick={() => Taro.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(item.id)}` })}>
          <Avatar value={item.other.avatar} className='conversation-card__avatar' />
          <View className='conversation-card__body'><View className='conversation-card__top'><Text className='conversation-card__name'>{item.other.nickname}</Text><Text className='conversation-card__time'>{formatConversationTime(item.lastMessageAt)}</Text></View>
            <View className='conversation-card__product'><ProductPhoto src={item.product.image} className='conversation-card__photo' /><Text>{item.product.title}</Text></View>
            <View className='conversation-card__bottom'><Text className='conversation-card__preview'>{item.lastMessage || '还没有消息，打声招呼吧'}</Text>{item.unreadCount > 0 && <Text className='conversation-card__unread'>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>}</View>
          </View>
        </View>)}
      </> : <EmptyState kind='messages' title='还没有消息' description='看到喜欢的好物，可以从商品详情联系卖家' action='去逛逛' onAction={() => Taro.reLaunch({ url: '/pages/index/index' })} />}
    </View>
    <TabNav active='messages' unreadCount={unreadCount} />
  </View>
}
