import { demoUser, mockProducts } from '../data/mock'
import type { ChatConversation, ChatMessage } from '../types/market'
import { apiRequest } from './api'
import { ensureUserSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { markMockConversationRead, sendMockMessage, startMockConversation, type MockChatState } from './mockChatCore'
import { getProduct } from './products'
import { readLocal, writeLocal } from './storage'

const MOCK_CHAT_KEY = 'campusmarket.chat.v1'

function seedState(): MockChatState {
  const product = mockProducts[0]
  const now = Date.now() - 30 * 60 * 1000
  const id = `mock-chat-${demoUser.id}-${product.id}`
  return {
    conversations: [{
      id, productId: product.id, buyerId: demoUser.id, sellerId: product.seller.id,
      other: { id: product.seller.id, nickname: product.seller.nickname, avatar: product.seller.avatar },
      product: { title: product.title, price: product.price, image: product.images[0], status: product.status },
      lastMessage: '还在的，可以约校内公共区域当面看看。', lastMessageAt: now + 60_000, unreadCount: 1, createdAt: now
    }],
    messages: [
      { id: 'mock-welcome-1', conversationId: id, senderId: demoUser.id, receiverId: product.seller.id, type: 'text', content: '你好，请问平板还在吗？', createdAt: now },
      { id: 'mock-welcome-2', conversationId: id, senderId: product.seller.id, receiverId: demoUser.id, type: 'text', content: '还在的，可以约校内公共区域当面看看。', createdAt: now + 60_000 }
    ]
  }
}

const mockState = () => readLocal<MockChatState>(MOCK_CHAT_KEY, seedState())
const saveMock = (state: MockChatState) => writeLocal(MOCK_CHAT_KEY, state)

async function freshMockConversation(item: ChatConversation): Promise<ChatConversation> {
  const live = await getProduct(item.productId)
  return live ? { ...item, product: { title: live.title, price: live.price, image: live.images[0] || '', status: live.status } } : { ...item, product: { ...item.product, status: 'deleted' } }
}

export async function currentChatUserId(): Promise<string> {
  return getDataMode() === 'mock' ? demoUser.id : (await ensureUserSession()).user.id
}

export async function startConversation(productId: string): Promise<ChatConversation> {
  const mode = getDataMode()
  if (mode === 'cloud') {
    await ensureUserSession()
    return cloudCall('startConversation', { productId })
  }
  if (mode === 'api') return apiRequest('/me/conversations', 'POST', { productId })
  const product = await getProduct(productId)
  if (!product) throw new Error('商品不存在')
  const result = startMockConversation(mockState(), product, demoUser.id, Date.now())
  saveMock(result.state)
  return result.conversation
}

export async function listConversations(): Promise<ChatConversation[]> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('listConversations')
  if (mode === 'api') return apiRequest('/me/conversations')
  return Promise.all([...mockState().conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt).map(freshMockConversation))
}

export async function getConversation(id: string): Promise<ChatConversation> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('getConversation', { id })
  if (mode === 'api') return apiRequest(`/me/conversations/${encodeURIComponent(id)}`)
  const item = mockState().conversations.find(conversation => conversation.id === id)
  if (!item) throw new Error('会话不存在或无权访问')
  return freshMockConversation(item)
}

export async function listMessages(id: string): Promise<ChatMessage[]> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('listMessages', { id })
  if (mode === 'api') return apiRequest(`/me/conversations/${encodeURIComponent(id)}/messages`)
  if (!mockState().conversations.some(item => item.id === id)) throw new Error('无权访问此会话')
  return mockState().messages.filter(item => item.conversationId === id).slice(-100)
}

export async function sendMessage(id: string, content: string): Promise<ChatMessage> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('sendMessage', { id, content })
  if (mode === 'api') return apiRequest(`/me/conversations/${encodeURIComponent(id)}/messages`, 'POST', { content })
  const result = sendMockMessage(mockState(), id, demoUser.id, content, Date.now())
  saveMock(result.state)
  return result.message
}

export async function markConversationRead(id: string): Promise<void> {
  const mode = getDataMode()
  if (mode === 'cloud') { await cloudCall('markConversationRead', { id }); return }
  if (mode === 'api') { await apiRequest(`/me/conversations/${encodeURIComponent(id)}/read`, 'POST'); return }
  saveMock(markMockConversationRead(mockState(), id, demoUser.id))
}

export async function getUnreadMessageCount(): Promise<number> {
  const mode = getDataMode()
  if (mode === 'cloud') return (await cloudCall<{ count: number }>('getUnreadMessageCount')).count
  if (mode === 'api') return (await apiRequest<{ count: number }>('/me/conversations/unread-count')).count
  return mockState().conversations.reduce((total, item) => total + item.unreadCount, 0)
}
