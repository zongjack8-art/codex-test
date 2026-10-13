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
}

export interface ProfileInput {
  nickname: string
  avatar: string
  school: string
  campus: string
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
