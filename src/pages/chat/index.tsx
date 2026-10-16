import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { getCurrentInstance, useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import { StatusBadge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import { currentChatUserId, getConversation, listMessages, markConversationRead, sendMessage } from '../../services/chat'
import type { ChatConversation, ChatMessage } from '../../types/market'
import { canOpenConversationProduct, formatMessageTime, groupMessagesByDay, mergeMessages, newIncomingMessages, sendContent } from '../../utils/chatPresentation'
import { retainRouteId } from '../../utils/routeId'
import { createVisiblePoller } from '../../utils/visiblePoller'

export default function ChatPage() {
  const conversationIdRef = useRef('')
  retainRouteId(conversationIdRef, getCurrentInstance().router?.params?.id)
  const [conversation, setConversation] = useState<ChatConversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [myId, setMyId] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sending, setSending] = useState(false)
  const [failedContent, setFailedContent] = useState<string | null>(null)
  const [scrollTarget, setScrollTarget] = useState<string | undefined>()
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const myIdRef = useRef('')
  const visibleRef = useRef(false)
  const atBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const loadingRef = useRef(false)
  const loadSequenceRef = useRef(0)
  const sendingRef = useRef(false)
  const needsReadRef = useRef(false)
  const readSequenceRef = useRef(0)
  const readInFlightRef = useRef(false)

  const scrollToLatest = (rows: ChatMessage[]) => {
    const last = rows[rows.length - 1]
    if (!last) return
    atBottomRef.current = true
    setHasNewMessages(false)
    setScrollTarget(`chat-message-${last.id}`)
  }

  const applyMessages = (rows: ChatMessage[], forceBottom = false, trackIncoming = true) => {
    const previous = messagesRef.current
    const id = conversationIdRef.current
    const fresh = trackIncoming ? newIncomingMessages(previous, rows, myIdRef.current, visibleRef.current, id) : []
    const merged = mergeMessages(previous, rows)
    messagesRef.current = merged
    setMessages(merged)
    if (fresh.length) { needsReadRef.current = true; readSequenceRef.current++ }
    if (forceBottom || (fresh.length && atBottomRef.current)) scrollToLatest(merged)
    else if (fresh.length) setHasNewMessages(true)
  }

  const markCurrentRead = async () => {
    const id = conversationIdRef.current
    if (!id || !visibleRef.current || !needsReadRef.current || readInFlightRef.current) return
    const sequence = readSequenceRef.current
    readInFlightRef.current = true
    try {
      await markConversationRead(id)
      if (sequence === readSequenceRef.current) needsReadRef.current = false
      setConversation(current => current?.id === id ? { ...current, unreadCount: 0 } : current)
    } catch { /* Retry on the next visible refresh. */ }
    finally { readInFlightRef.current = false }
  }

  const load = async () => {
    if (loadingRef.current) return
    const sequence = ++loadSequenceRef.current
    loadingRef.current = true
    setLoading(true); setError(false)
    try {
      const id = retainRouteId(conversationIdRef, getCurrentInstance().router?.params?.id)
      if (!id) throw new Error('会话链接缺少编号')
      const previous = messagesRef.current
      const [userId, item, rows] = await Promise.all([
        myIdRef.current ? Promise.resolve(myIdRef.current) : currentChatUserId(),
        getConversation(id), listMessages(id)
      ])
      if (!visibleRef.current || sequence !== loadSequenceRef.current) return
      myIdRef.current = userId
      setMyId(userId); setConversation(item)
      const newForMe = newIncomingMessages(previous, rows, userId, true, id)
      applyMessages(rows, true, false)
      if (item.unreadCount || (previous.length > 0 && newForMe.length)) { needsReadRef.current = true; readSequenceRef.current++ }
      await markCurrentRead()
    } catch { if (visibleRef.current && sequence === loadSequenceRef.current) setError(true) }
    finally { if (sequence === loadSequenceRef.current) { loadingRef.current = false; setLoading(false) } }
  }

  const poller = useRef<ReturnType<typeof createVisiblePoller> | null>(null)
  if (!poller.current) poller.current = createVisiblePoller(async isCurrent => {
    const id = conversationIdRef.current
    if (!id || loadingRef.current || sendingRef.current) return
    try {
      const rows = await listMessages(id)
      if (!isCurrent() || !visibleRef.current || sendingRef.current || id !== conversationIdRef.current) return
      applyMessages(rows)
      await markCurrentRead()
    } catch { /* Keep the last successful messages and try again next time. */ }
  }, 6000)

  useDidShow(() => { visibleRef.current = true; void load(); poller.current?.start() })
  useDidHide(() => { visibleRef.current = false; loadSequenceRef.current++; loadingRef.current = false; poller.current?.stop() })
  useEffect(() => () => { visibleRef.current = false; poller.current?.stop() }, [])

  const send = async (retryContent?: string | null) => {
    const id = conversationIdRef.current
    const draftAtStart = text
    const content = sendContent(text, retryContent)
    if (!id || sendingRef.current || !content) return
    if (content.length > 500) return Taro.showToast({ title: '消息不能超过 500 字', icon: 'none' })
    sendingRef.current = true; setSending(true)
    try {
      const message = await sendMessage(id, content)
      applyMessages([message], true, false)
      setText(current => current === draftAtStart && current.trim() === content ? '' : current)
      setFailedContent(current => current === content ? null : current)
    } catch { setFailedContent(content); Taro.showToast({ title: '发送失败，请重试', icon: 'none' }) }
    finally { sendingRef.current = false; setSending(false) }
  }

  const copyMessage = async (content: string) => {
    if (typeof Taro.showActionSheet === 'function') {
      try {
        const choice = await Taro.showActionSheet({ itemList: ['复制'] })
        if (choice.tapIndex !== 0) return
      } catch { return }
    }
    try { await Taro.setClipboardData({ data: content }) }
    catch { Taro.showToast({ title: '暂时无法复制', icon: 'none' }) }
  }

  if (loading) return <View className='page chat-page'><View className='listing-skeleton content-pad'><View /><View /></View></View>
  if (error || !conversation) return <View className='page'><EmptyState kind='error' title='暂时无法打开对话' description='会话可能不存在、无权查看，或网络暂时不可用' action='重试' onAction={() => void load()} /></View>
  const groups = groupMessagesByDay(messages)
  return <View className='page chat-page'>
    <View className='chat-product' onClick={() => canOpenConversationProduct(conversation.product.status) && Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(conversation.productId)}` })}>
      <ProductPhoto src={conversation.product.image} className='chat-product__photo' />
      <View className='chat-product__info'><Text className='chat-product__title'>{conversation.product.title}</Text><View className='chat-product__meta'><Text>¥{conversation.product.price}</Text>{conversation.product.status === 'deleted' ? <Text className='chat-product__deleted'>商品已删除</Text> : <StatusBadge status={conversation.product.status} />}</View></View>
    </View>
    <Text className='chat-safety'>建议在校内公共区域面交，验货后再付款。平台不提供支付担保。</Text>
    <ScrollView scrollY className='chat-scroll' scrollIntoView={scrollTarget} onScroll={event => {
      const top = event.detail.scrollTop
      if (top < lastScrollTopRef.current - 8) atBottomRef.current = false
      lastScrollTopRef.current = top
    }} onScrollToLower={() => { atBottomRef.current = true; setHasNewMessages(false) }}>
      {messages.length ? <View className='chat-messages'>{groups.map(group => <View key={group.key} className='chat-day-group'>
        <Text className='chat-day-label'>{group.label}</Text>
        {group.messages.map(message => <View id={`chat-message-${message.id}`} key={message.id} className={`chat-message ${message.senderId === myId ? 'chat-message--mine' : ''}`}><Text className='chat-message__bubble' onLongPress={() => void copyMessage(message.content)}>{message.content}</Text><Text className='chat-message__time'>{formatMessageTime(message.createdAt)}</Text></View>)}
      </View>)}</View> : <EmptyState kind='messages' title='还没有聊天记录' description='先发一句问候，聊聊商品和方便面交的时间' />}
    </ScrollView>
    {hasNewMessages && <Text className='chat-new-message' onClick={() => scrollToLatest(messagesRef.current)}>有新消息 · 查看最新</Text>}
    {failedContent && <Text className='chat-send-error' onClick={() => void send(failedContent)}>“{failedContent}”发送失败，点此重试</Text>}
    <View className='chat-composer'><Input className='chat-composer__input' value={text} maxlength={500} cursorSpacing={20} confirmType='send' onConfirm={() => void send()} onInput={event => setText(event.detail.value)} placeholder='和同学聊聊这件好物…' /><AppButton onClick={() => void send()} loading={sending} disabled={sending || !text.trim()}>发送</AppButton></View>
  </View>
}
