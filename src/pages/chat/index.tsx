import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import { StatusBadge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import { currentChatUserId, getConversation, listMessages, markConversationRead, sendMessage } from '../../services/chat'
import type { ChatConversation, ChatMessage } from '../../types/market'

function clock(value: number): string {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export default function ChatPage() {
  const id = getCurrentInstance().router?.params?.id || ''
  const [conversation, setConversation] = useState<ChatConversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [myId, setMyId] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const polling = useRef<ReturnType<typeof setInterval> | null>(null)
  const loadingRef = useRef(false)
  const sendingRef = useRef(false)

  const refresh = async (silent = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (!silent) { setLoading(true); setError(false) }
    try {
      const [userId, item, rows] = await Promise.all([currentChatUserId(), getConversation(id), listMessages(id)])
      setMyId(userId); setConversation(item); setMessages(rows)
      if (item.unreadCount) await markConversationRead(id)
    } catch { if (!silent) setError(true) }
    finally { loadingRef.current = false; if (!silent) setLoading(false) }
  }
  useDidShow(() => {
    void refresh()
    if (polling.current) clearInterval(polling.current)
    polling.current = setInterval(() => { if (!sendingRef.current) void refresh(true) }, 15000)
  })
  useDidHide(() => { if (polling.current) clearInterval(polling.current); polling.current = null })
  useEffect(() => () => { if (polling.current) clearInterval(polling.current) }, [])

  const send = async () => {
    const content = text.trim()
    if (sendingRef.current || !content) return
    if (content.length > 500) return Taro.showToast({ title: '消息不能超过 500 字', icon: 'none' })
    sendingRef.current = true; setSending(true); setSendError(false)
    try {
      const message = await sendMessage(id, content)
      setMessages(current => [...current, message])
      setText('')
      void refresh(true)
    } catch { setSendError(true); Taro.showToast({ title: '发送失败，请重试', icon: 'none' }) }
    finally { sendingRef.current = false; setSending(false) }
  }

  if (loading) return <View className='page chat-page'><View className='listing-skeleton content-pad'><View /><View /></View></View>
  if (error || !conversation) return <View className='page'><EmptyState kind='error' title='暂时无法打开对话' description='会话可能不存在、无权查看，或网络暂时不可用' action='重试' onAction={() => void refresh()} /></View>
  return <View className='page chat-page'>
    <View className='chat-product' onClick={() => conversation.product.status !== 'deleted' && conversation.product.status !== 'offline' && Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(conversation.productId)}` })}>
      <ProductPhoto src={conversation.product.image} className='chat-product__photo' />
      <View className='chat-product__info'><Text className='chat-product__title'>{conversation.product.title}</Text><View className='chat-product__meta'><Text>¥{conversation.product.price}</Text>{conversation.product.status === 'deleted' ? <Text className='chat-product__deleted'>商品已删除</Text> : <StatusBadge status={conversation.product.status} />}</View></View>
    </View>
    <Text className='chat-safety'>建议在校内公共区域面交，验货后再付款。平台不提供支付担保。</Text>
    <ScrollView scrollY className='chat-scroll' scrollIntoView={messages.length ? `chat-message-${messages[messages.length - 1].id}` : undefined}>
      {messages.length ? <View className='chat-messages'>{messages.map(message => <View id={`chat-message-${message.id}`} key={message.id} className={`chat-message ${message.senderId === myId ? 'chat-message--mine' : ''}`}><Text className='chat-message__bubble'>{message.content}</Text><Text className='chat-message__time'>{clock(message.createdAt)}</Text></View>)}</View> : <EmptyState kind='messages' title='还没有聊天记录' description='先发一句问候，聊聊商品和方便面交的时间' />}
    </ScrollView>
    {sendError && <Text className='chat-send-error' onClick={send}>上一条发送失败，点此重试</Text>}
    <View className='chat-composer'><Input className='chat-composer__input' value={text} maxlength={500} cursorSpacing={20} confirmType='send' onConfirm={send} onInput={event => setText(event.detail.value)} placeholder='和同学聊聊这件好物…' /><AppButton onClick={send} loading={sending} disabled={!text.trim()}>发送</AppButton></View>
  </View>
}
