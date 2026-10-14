import type { ChatConversation, ChatMessage, Product } from '../types/market'

export interface MockChatState { conversations: ChatConversation[]; messages: ChatMessage[] }

export function startMockConversation(state: MockChatState, product: Product, buyerId: string, now: number): { state: MockChatState; conversation: ChatConversation } {
  if (product.seller.id === buyerId) throw new Error('不能给自己发送消息')
  if (product.status !== 'selling') throw new Error('这件商品当前无法联系卖家')
  const id = `mock-chat-${buyerId}-${product.id}`
  const existing = state.conversations.find(item => item.id === id)
  if (existing) return { state, conversation: existing }
  const conversation: ChatConversation = {
    id, productId: product.id, buyerId, sellerId: product.seller.id,
    other: { id: product.seller.id, nickname: product.seller.nickname, avatar: product.seller.avatar },
    product: { title: product.title, price: product.price, image: product.images[0] || '', status: product.status },
    lastMessage: '', lastMessageAt: now, unreadCount: 0, createdAt: now
  }
  return { state: { ...state, conversations: [conversation, ...state.conversations] }, conversation }
}

export function sendMockMessage(state: MockChatState, id: string, senderId: string, content: string, now: number): { state: MockChatState; message: ChatMessage } {
  const conversation = state.conversations.find(item => item.id === id)
  if (!conversation || (conversation.buyerId !== senderId && conversation.sellerId !== senderId)) throw new Error('无权访问此会话')
  const clean = content.trim()
  if (!clean || clean.length > 500) throw new Error('请输入 1 至 500 字的消息')
  const receiverId = conversation.buyerId === senderId ? conversation.sellerId : conversation.buyerId
  const message: ChatMessage = { id: `mock-message-${now}-${Math.random().toString(36).slice(2, 8)}`, conversationId: id, senderId, receiverId, type: 'text', content: clean, createdAt: now }
  return {
    state: {
      conversations: state.conversations.map(item => item.id === id ? { ...item, lastMessage: clean.slice(0, 80), lastMessageAt: now, unreadCount: item.buyerId === receiverId ? item.unreadCount + 1 : item.unreadCount } : item),
      messages: [...state.messages, message]
    },
    message
  }
}

export function markMockConversationRead(state: MockChatState, id: string, userId: string): MockChatState {
  const conversation = state.conversations.find(item => item.id === id)
  if (!conversation || (conversation.buyerId !== userId && conversation.sellerId !== userId)) throw new Error('无权访问此会话')
  return { ...state, conversations: state.conversations.map(item => item.id === id ? { ...item, unreadCount: 0 } : item) }
}
