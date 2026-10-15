import { ensureUserSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import type { ReportReason } from './reports'

export interface AdminProduct {
  id: string
  title: string
  image: string
  price: number
  status: 'selling' | 'sold' | 'offline'
  createdAt: number
  sellerId: string
  sellerNickname: string
  sellerAvatar: string
  moderationStatus: 'blocked' | null
}

export interface AdminReport {
  id: string
  productId: string
  reason: ReportReason
  description: string
  reporterId: string
  createdAt: number
  status: 'pending' | 'resolved' | 'dismissed'
  productTitle: string
  productImage: string
  sellerNickname: string
}

async function adminCall<T>(action: string, params: object = {}): Promise<T> {
  if (getDataMode() !== 'cloud') throw new Error('管理后台仅支持微信云开发模式')
  await ensureUserSession()
  return cloudCall<T>(action, params)
}

export async function getAdminStatus(): Promise<{ isAdmin: boolean }> {
  if (getDataMode() !== 'cloud') return { isAdmin: false }
  return cloudCall('getAdminStatus')
}

export const adminListProducts = () => adminCall<AdminProduct[]>('adminListProducts')
export const adminTakeDownProduct = (id: string, reason: string) => adminCall<{ takenDown: boolean }>('adminTakeDownProduct', { id, reason })
export const adminListReports = () => adminCall<AdminReport[]>('adminListReports')
export const adminResolveReport = (id: string, resolution: 'takedown' | 'dismiss') => adminCall<{ resolved: boolean }>('adminResolveReport', { id, resolution })
