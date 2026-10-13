import { demoUser, mockProducts } from '../data/mock'
import type { Product, ProductFilters, ProductInput, ProductStatus, Seller } from '../types/market'
import { apiRequest } from './api'
import { ensureUserSession, getSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { readLocal, writeLocal } from './storage'
import { removeMockImage } from './upload'

const PRODUCTS_KEY = 'campusmarket.products.v2'
const FAVORITES_KEY = 'campusmarket.favorites.v2'

interface CloudProduct {
  _id: string
  sellerId: string
  seller?: Seller
  title: string
  description: string
  price: number
  originalPrice?: number | null
  category: Product['category']
  condition: string
  images: string[]
  location: string
  status: ProductStatus
  createdAt: number
}

function fromCloud(item: CloudProduct): Product {
  return {
    id: item._id,
    title: item.title,
    description: item.description,
    price: item.price,
    originalPrice: item.originalPrice ?? undefined,
    category: item.category,
    condition: item.condition,
    images: item.images || [],
    campus: item.location,
    status: item.status,
    createdAt: new Date(item.createdAt).toISOString(),
    seller: item.seller || { id: item.sellerId, nickname: '校园同学', campus: item.location, avatar: '🎓' },
    coverEmoji: '🎁',
    coverColor: '#e8efe9'
  }
}

function localProducts(): Product[] {
  const currentUser = getSession()?.user || demoUser
  return readLocal<Product[]>(PRODUCTS_KEY, mockProducts).map(product => {
    // Refresh built-in demo listings without overwriting user-created local listings.
    const seed = mockProducts.find(item => item.id === product.id)
    const item = seed && product.seller.id !== demoUser.id ? { ...seed, status: product.status } : product
    return item.seller.id === demoUser.id ? { ...item, seller: currentUser } : item
  })
}

function ownedLocalProduct(id: string): Product {
  const product = localProducts().find(item => item.id === id)
  if (!product || product.seller.id !== demoUser.id) throw new Error('商品不存在或无权操作')
  return product
}

export async function getProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const mode = getDataMode()
  if (mode === 'cloud') return (await cloudCall<CloudProduct[]>('listProducts', { filters })).map(fromCloud)
  if (mode === 'api') {
    const query = Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
    return apiRequest<Product[]>(`/products${query ? `?${query}` : ''}`)
  }
  const keyword = filters.keyword?.trim().toLowerCase()
  const products = localProducts().filter(product =>
    product.status === 'selling' &&
    (!filters.category || filters.category === 'all' || product.category === filters.category) &&
    (!keyword || `${product.title} ${product.description}`.toLowerCase().includes(keyword))
  )
  return products.sort((a, b) => filters.sort === 'priceAsc' ? a.price - b.price : filters.sort === 'priceDesc' ? b.price - a.price : Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export async function getProduct(id: string): Promise<Product | null> {
  if (getDataMode() === 'cloud') {
    const item = await cloudCall<CloudProduct | null>('getProduct', { id })
    return item ? fromCloud(item) : null
  }
  if (getDataMode() === 'api') return apiRequest<Product>(`/products/${encodeURIComponent(id)}`)
  return localProducts().find(product => product.id === id) || null
}

export async function createProduct(input: ProductInput): Promise<Product> {
  if (getDataMode() === 'cloud') {
    await ensureUserSession()
    return fromCloud(await cloudCall<CloudProduct>('createProduct', { product: { ...input, location: input.campus } }))
  }
  if (getDataMode() === 'api') return apiRequest<Product>('/products', 'POST', input)
  const product: Product = {
    ...input,
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    seller: getSession()?.user || demoUser,
    coverEmoji: '🎁',
    coverColor: '#e8efe9',
    createdAt: new Date().toISOString(),
    status: 'selling'
  }
  writeLocal(PRODUCTS_KEY, [product, ...localProducts()])
  return product
}

export async function updateProduct(id: string, input: ProductInput): Promise<Product> {
  if (getDataMode() === 'cloud') return fromCloud(await cloudCall<CloudProduct>('updateProduct', { id, product: { ...input, location: input.campus } }))
  if (getDataMode() === 'api') return apiRequest<Product>(`/products/${encodeURIComponent(id)}`, 'PATCH', input)
  const previous = ownedLocalProduct(id)
  const updated = localProducts().map(item => item.id === id ? { ...item, ...input } : item)
  writeLocal(PRODUCTS_KEY, updated)
  await Promise.all(previous.images.filter(image => !input.images.includes(image)).map(removeMockImage))
  return updated.find(item => item.id === id) as Product
}

export async function getMyProducts(): Promise<Product[]> {
  if (getDataMode() === 'cloud') return (await cloudCall<CloudProduct[]>('getMyProducts')).map(fromCloud)
  if (getDataMode() === 'api') return apiRequest<Product[]>('/me/products')
  return localProducts().filter(product => product.seller.id === demoUser.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export async function setProductStatus(id: string, status: ProductStatus): Promise<void> {
  if (getDataMode() === 'cloud') { await cloudCall('setProductStatus', { id, status }); return }
  if (getDataMode() === 'api') { await apiRequest(`/products/${encodeURIComponent(id)}`, 'PATCH', { status }); return }
  ownedLocalProduct(id)
  writeLocal(PRODUCTS_KEY, localProducts().map(product => product.id === id ? { ...product, status } : product))
}

export async function deleteProduct(id: string): Promise<void> {
  if (getDataMode() === 'cloud') { await cloudCall('deleteProduct', { id }); return }
  if (getDataMode() === 'api') { await apiRequest(`/products/${encodeURIComponent(id)}`, 'DELETE'); return }
  const product = ownedLocalProduct(id)
  writeLocal(PRODUCTS_KEY, localProducts().filter(product => product.id !== id))
  writeLocal(FAVORITES_KEY, (await getFavoriteIds()).filter(item => item !== id))
  await Promise.all(product.images.map(removeMockImage))
}

export async function getFavoriteIds(): Promise<string[]> {
  if (getDataMode() === 'cloud') return cloudCall<string[]>('getFavoriteIds')
  if (getDataMode() === 'api') return apiRequest<string[]>('/me/favorites/ids')
  return readLocal<string[]>(FAVORITES_KEY, [])
}

export async function getFavorites(): Promise<Product[]> {
  if (getDataMode() === 'cloud') return (await cloudCall<CloudProduct[]>('getFavorites')).map(fromCloud)
  if (getDataMode() === 'api') return apiRequest<Product[]>('/me/favorites')
  const ids = await getFavoriteIds()
  return localProducts().filter(product => ids.includes(product.id))
}

export async function toggleFavorite(id: string): Promise<boolean> {
  if (getDataMode() === 'cloud') {
    await ensureUserSession()
    const favorited = !(await getFavoriteIds()).includes(id)
    const result = await cloudCall<{ favorited: boolean }>('setFavorite', { id, favorited })
    return result.favorited
  }
  if (getDataMode() === 'api') {
    const result = await apiRequest<{ favorited: boolean }>(`/products/${encodeURIComponent(id)}/favorite`, 'POST')
    return result.favorited
  }
  const ids = await getFavoriteIds()
  const favorited = !ids.includes(id)
  if (favorited && !localProducts().some(product => product.id === id && product.status === 'selling')) throw new Error('该商品当前不可收藏')
  writeLocal(FAVORITES_KEY, favorited ? [...ids, id] : ids.filter(item => item !== id))
  return favorited
}
