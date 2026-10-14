export type CategoryId = 'books' | 'digital' | 'daily' | 'sports' | 'fashion' | 'other'
export type ProductStatus = 'selling' | 'sold' | 'offline'

export interface Seller {
  id: string
  nickname: string
  campus: string
  school?: string
  avatar: string
}

export interface UserProfile extends Seller {
  school: string
  bio?: string
}

export interface ProfileInput {
  nickname: string
  avatar: string
  school: string
  campus: string
  bio?: string
}

export interface Product {
  id: string
  title: string
  description: string
  price: number
  originalPrice?: number
  category: CategoryId
  condition: string
  campus: string
  images: string[]
  coverEmoji: string
  coverColor: string
  seller: Seller
  createdAt: string
  status: ProductStatus
}

export interface ProductInput {
  title: string
  description: string
  price: number
  originalPrice?: number
  category: CategoryId
  condition: string
  campus: string
  images: string[]
}

export interface ProductFilters {
  keyword?: string
  category?: CategoryId | 'all'
  sort?: 'newest' | 'priceAsc' | 'priceDesc'
}

export interface Session {
  token?: string
  user: UserProfile
}

export interface ChatProductSnapshot {
  title: string
  price: number
  image: string
  status: ProductStatus | 'deleted'
}

export interface ChatConversation {
  id: string
  productId: string
  buyerId: string
  sellerId: string
  other: Pick<Seller, 'id' | 'nickname' | 'avatar'>
  product: ChatProductSnapshot
  lastMessage: string
  lastMessageAt: number
  unreadCount: number
  createdAt: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  receiverId: string
  type: 'text'
  content: string
  createdAt: number
}
