import type { Product, ProductStatus } from '../types/market'

export type FavoriteFilter = 'all' | Extract<ProductStatus, 'selling' | 'reserved' | 'sold'>

export function filterFavoriteProducts(products: Product[], status: FavoriteFilter): Product[] {
  return products.filter(product => product.status !== 'offline' && (status === 'all' || product.status === status))
}
