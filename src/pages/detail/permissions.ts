import type { Product } from '../../types/market'

/** Unknown ownership must not expose buyer actions while an older market function is deployed. */
export function detailPermissions(product: Pick<Product, 'status' | 'viewerIsSeller'>) {
  const isSeller = product.viewerIsSeller === true
  const isBuyer = product.viewerIsSeller === false
  const canTrade = isBuyer && product.status === 'selling'
  return {
    ownershipKnown: isSeller || isBuyer,
    canManage: isSeller,
    canFavorite: canTrade,
    canContact: canTrade,
    canReport: isBuyer
  }
}
