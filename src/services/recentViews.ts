import { campusConfig } from '../config/campus'
import { demoUser } from '../data/mock'
import type { Product } from '../types/market'
import { getSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { fromCloud, getProduct, type CloudProduct } from './products'
import { readLocal, writeLocal } from './storage'

const KEY = 'campusmarket.recentViews.v1'
const MAX_VIEWS = 50
interface LocalView { userId: string; productId: string; school: string; viewedAt: number }

const currentUserId = () => getSession()?.user.id || demoUser.id
const localViews = () => readLocal<LocalView[]>(KEY, [])

export async function recordProductView(productId: string): Promise<boolean> {
  if (!productId) return false
  if (getDataMode() === 'cloud') {
    await cloudCall('recordProductView', { productId })
    return true
  }
  const product = await getProduct(productId)
  if (!product || product.status === 'offline' || product.moderationStatus === 'blocked' || product.school && product.school !== campusConfig.schoolName) return false
  const userId = currentUserId()
  const rows = localViews()
  const own = rows.filter(row => row.userId === userId && row.school === campusConfig.schoolName)
  const viewedAt = Math.max(Date.now(), ...own.map(row => row.viewedAt + 1))
  const next = [{ userId, productId, school: campusConfig.schoolName, viewedAt }, ...own.filter(row => row.productId !== productId)]
    .sort((a, b) => b.viewedAt - a.viewedAt).slice(0, MAX_VIEWS)
  writeLocal(KEY, [...rows.filter(row => row.userId !== userId || row.school !== campusConfig.schoolName), ...next])
  return true
}

export async function listRecentViews(): Promise<Product[]> {
  if (getDataMode() === 'cloud') return (await cloudCall<CloudProduct[]>('listRecentViews')).map(fromCloud)
  const userId = currentUserId()
  const rows = localViews().filter(row => row.userId === userId && row.school === campusConfig.schoolName)
    .sort((a, b) => b.viewedAt - a.viewedAt).slice(0, MAX_VIEWS)
  const products = await Promise.all(rows.map(row => getProduct(row.productId).catch(() => null)))
  return products.filter((product): product is Product => Boolean(product && product.status !== 'offline' && product.moderationStatus !== 'blocked' && (!product.school || product.school === campusConfig.schoolName)))
}

export async function clearRecentViews(): Promise<void> {
  if (getDataMode() === 'cloud') { await cloudCall('clearRecentViews'); return }
  const userId = currentUserId()
  writeLocal(KEY, localViews().filter(row => row.userId !== userId || row.school !== campusConfig.schoolName))
}
