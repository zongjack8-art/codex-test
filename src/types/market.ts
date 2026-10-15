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
  moderationStatus?: 'blocked'
  /** Set by getProduct; in Cloud mode this comes from the market function's OPENID check. */
  viewerIsSeller?: boolean
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

export type OrderStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled'
export type OrderRole = 'buyer' | 'seller'

export interface OrderUnreadSummary {
  buyer: number
  seller: number
  total: number
}

export interface MarketOrder {
  id: string
  productId: string
  buyerId: string
  sellerId: string
  productTitle: string
  productImage: string
  amount: number
  status: OrderStatus
  /** Read state for the current user's role; absent on older HTTP implementations. */
  unread?: boolean
  role: OrderRole
  other: Pick<Seller, 'nickname' | 'avatar'>
  createdAt: number
  updatedAt: number
  completedAt: number | null
  cancelledAt: number | null
}
