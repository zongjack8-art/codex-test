import type { MarketOrder, OrderStatus } from '../types/market'

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: '待卖家确认', confirmed: '待面交', completed: '已完成', cancelled: '已取消'
}

export const unreadCountLabel = (count: number): string => count > 99 ? '99+' : String(count)

export function orderActions(order: Pick<MarketOrder, 'role' | 'status'>): ('confirmOrder' | 'completeOrder' | 'cancelOrder')[] {
  if (order.status === 'pending') return order.role === 'seller' ? ['confirmOrder', 'cancelOrder'] : ['cancelOrder']
  if (order.status === 'confirmed') return order.role === 'seller' ? ['completeOrder', 'cancelOrder'] : ['cancelOrder']
  return []
}

export function formatOrderTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '时间待补充'
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
