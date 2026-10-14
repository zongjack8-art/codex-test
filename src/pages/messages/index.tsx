import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import Avatar from '../../components/Avatar'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import TabNav from '../../components/TabNav'
import { isH5CloudFallback } from '../../services/mode'
import { getUnreadMessageCount, listConversations } from '../../services/chat'
import type { ChatConversation } from '../../types/market'

function chatTime(value: number): string {
  const date = new Date(value)
  const now = new Date()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return date.toDateString() === now.toDateString() ? time : `${date.getMonth() + 1}月${date.getDate()}日`
}

export default function MessagesPage() {
  const [items, setItems] = useState<ChatConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const load = () => {
    setLoading(true); setError(false)
    Promise.all([listConversations(), getUnreadMessageCount()]).then(([conversations, count]) => { setItems(conversations); setUnreadCount(count) }).catch(() => setError(true)).finally(() => setLoading(false))
  }
  useDidShow(load)

  return <View className='page page--with-nav'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>CAMPUS CONVERSATIONS</Text><Text className='page-heading__title'>消息</Text><Text className='page-heading__desc'>和同学聊聊好物，约个方便的校内地点。</Text></View>
    <View className='content-pad messages-content'>
      {isH5CloudFallback() && <Text className='mode-banner'>H5 当前使用本机演示消息。</Text>}
      {loading ? <View className='listing-skeleton'><View /><View /></View> : error ? <EmptyState kind='error' title='暂时没能加载消息' description='检查网络后再试一次' action='重试' onAction={load} /> : items.length ? <>
        <View className='messages-summary'><Text>和同学的对话</Text><Text>{unreadCount ? `${unreadCount} 条未读` : '消息已读完'}</Text></View>
        {items.map(item => <View key={item.id} className='conversation-card' onClick={() => Taro.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(item.id)}` })}>
          <Avatar value={item.other.avatar} className='conversation-card__avatar' />
          <View className='conversation-card__body'><View className='conversation-card__top'><Text className='conversation-card__name'>{item.other.nickname}</Text><Text className='conversation-card__time'>{chatTime(item.lastMessageAt)}</Text></View>
            <View className='conversation-card__product'><ProductPhoto src={item.product.image} className='conversation-card__photo' /><Text>{item.product.title}</Text></View>
            <View className='conversation-card__bottom'><Text className='conversation-card__preview'>{item.lastMessage || '还没有消息，打声招呼吧'}</Text>{item.unreadCount > 0 && <Text className='conversation-card__unread'>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>}</View>
          </View>
        </View>)}
      </> : <EmptyState kind='messages' title='还没有消息' description='看到喜欢的好物，可以从商品详情联系卖家' action='去逛逛' onAction={() => Taro.reLaunch({ url: '/pages/index/index' })} />}
    </View>
    <TabNav active='messages' unreadCount={unreadCount} />
  </View>
}
