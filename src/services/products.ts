import { demoUser, mockProducts } from '../data/mock'
import type { Product, ProductFilters, ProductInput, ProductStatus } from '../types/market'
import { apiRequest } from './api'
import { readLocal, writeLocal } from './storage'

const PRODUCTS_KEY = 'campusmarket.products.v1'
const FAVORITES_KEY = 'campusmarket.favorites.v1'

function localProducts(): Product[] {
  return readLocal<Product[]>(PRODUCTS_KEY, mockProducts)
}

export async function getProducts(filters: ProductFilters = {}): Promise<Product[]> {
  if (__API_BASE_URL__) {
    const query = Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
    return apiRequest<Product[]>(`/products${query ? `?${query}` : ''}`)
  }
  const keyword = filters.keyword?.trim().toLowerCase()
  const products = localProducts().filter(product =>
    product.status === 'available' &&
    (!filters.category || filters.category === 'all' || product.category === filters.category) &&
    (!keyword || `${product.title} ${product.description}`.toLowerCase().includes(keyword))
  )
  return products.sort((a, b) => filters.sort === 'priceAsc' ? a.price - b.price : filters.sort === 'priceDesc' ? b.price - a.price : b.createdAt.localeCompare(a.createdAt))
}

export async function getProduct(id: string): Promise<Product | null> {
  if (__API_BASE_URL__) return apiRequest<Product>(`/products/${encodeURIComponent(id)}`)
  return localProducts().find(product => product.id === id) || null
}

export async function createProduct(input: ProductInput): Promise<Product> {
  if (__API_BASE_URL__) return apiRequest<Product>('/products', 'POST', input)
  const product: Product = {
    ...input,
    id: `local-${Date.now()}`,
    seller: demoUser,
    coverEmoji: '🎁',
    coverColor: '#e8efe9',
    createdAt: new Date().toISOString(),
    status: 'available'
  }
  writeLocal(PRODUCTS_KEY, [product, ...localProducts()])
  return product
}

export async function getMyProducts(): Promise<Product[]> {
  if (__API_BASE_URL__) return apiRequest<Product[]>('/me/products')
  return localProducts().filter(product => product.seller.id === demoUser.id)
}

export async function setProductStatus(id: string, status: ProductStatus): Promise<void> {
  if (__API_BASE_URL__) { await apiRequest(`/products/${encodeURIComponent(id)}`, 'PATCH', { status }); return }
  writeLocal(PRODUCTS_KEY, localProducts().map(product => product.id === id ? { ...product, status } : product))
}

export async function deleteProduct(id: string): Promise<void> {
  if (__API_BASE_URL__) { await apiRequest(`/products/${encodeURIComponent(id)}`, 'DELETE'); return }
  writeLocal(PRODUCTS_KEY, localProducts().filter(product => product.id !== id))
}

export async function getFavoriteIds(): Promise<string[]> {
  if (__API_BASE_URL__) return apiRequest<string[]>('/me/favorites/ids')
  return readLocal<string[]>(FAVORITES_KEY, [])
}

export async function getFavorites(): Promise<Product[]> {
  if (__API_BASE_URL__) return apiRequest<Product[]>('/me/favorites')
  const ids = await getFavoriteIds()
  return localProducts().filter(product => ids.includes(product.id))
}

export async function toggleFavorite(id: string): Promise<boolean> {
  if (__API_BASE_URL__) {
    const result = await apiRequest<{ favorited: boolean }>(`/products/${encodeURIComponent(id)}/favorite`, 'POST')
    return result.favorited
  }
  const ids = await getFavoriteIds()
  const favorited = !ids.includes(id)
  writeLocal(FAVORITES_KEY, favorited ? [...ids, id] : ids.filter(item => item !== id))
  return favorited
}
