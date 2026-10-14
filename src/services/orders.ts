import { demoUser } from '../data/mock'
import type { MarketOrder, OrderRole, Product } from '../types/market'
import { apiRequest } from './api'
import { ensureUserSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { getProduct, setProductStatus } from './products'
import { readLocal, writeLocal } from './storage'

const ORDERS_KEY = 'campusmarket.orders.v1'
const mockOrders = () => readLocal<MarketOrder[]>(ORDERS_KEY, [])
const saveMockOrders = (orders: MarketOrder[]) => writeLocal(ORDERS_KEY, orders)
const active = (status: MarketOrder['status']) => status === 'pending' || status === 'confirmed'

export async function createOrder(productId: string): Promise<MarketOrder> {
  const mode = getDataMode()
  if (mode === 'cloud') { await ensureUserSession(); return cloudCall('createOrder', { productId }) }
  if (mode === 'api') return apiRequest('/me/orders', 'POST', { productId })
  const product = await getProduct(productId)
  if (!product) throw new Error('商品不存在')
  if (product.seller.id === demoUser.id) throw new Error('不能购买自己发布的商品')
  if (product.status !== 'selling') throw new Error('这件商品当前无法发起订单')
  if (mockOrders().some(order => order.productId === productId && order.buyerId === demoUser.id && active(order.status))) throw new Error('你已经有一笔进行中的订单')
  const now = Date.now()
  const order: MarketOrder = {
    id: `mock-order-${now}-${Math.random().toString(36).slice(2, 8)}`, productId,
    buyerId: demoUser.id, sellerId: product.seller.id,
    productTitle: product.title, productImage: product.images[0] || '', amount: product.price,
    status: 'pending', role: 'buyer', other: { nickname: product.seller.nickname, avatar: product.seller.avatar },
    createdAt: now, updatedAt: now, completedAt: null, cancelledAt: null
  }
  saveMockOrders([order, ...mockOrders()])
  return order
}

export async function listOrders(role: OrderRole): Promise<MarketOrder[]> {
  if (getDataMode() === 'cloud') return cloudCall('listOrders', { role })
  if (getDataMode() === 'api') return apiRequest(`/me/orders?role=${role}`)
  return mockOrders().filter(order => role === 'buyer' ? order.buyerId === demoUser.id : order.sellerId === demoUser.id).map(order => ({ ...order, role })).sort((a, b) => b.createdAt - a.createdAt)
}

export async function getOrder(id: string): Promise<MarketOrder> {
  if (getDataMode() === 'cloud') return cloudCall('getOrder', { id })
  if (getDataMode() === 'api') return apiRequest(`/me/orders/${encodeURIComponent(id)}`)
  const order = mockOrders().find(item => item.id === id)
  if (!order || (order.buyerId !== demoUser.id && order.sellerId !== demoUser.id)) throw new Error('订单不存在或无权查看')
  return { ...order, role: order.buyerId === demoUser.id ? 'buyer' : 'seller' }
}

export async function changeOrder(id: string, action: 'confirmOrder' | 'completeOrder' | 'cancelOrder'): Promise<MarketOrder> {
  if (getDataMode() === 'cloud') return cloudCall(action, { id })
  if (getDataMode() === 'api') return apiRequest(`/me/orders/${encodeURIComponent(id)}/${action}`, 'POST')
  const order = await getOrder(id)
  if (action !== 'cancelOrder' && order.role !== 'seller') throw new Error('只有卖家可以操作')
  const next = action === 'confirmOrder' ? 'confirmed' : action === 'completeOrder' ? 'completed' : 'cancelled'
  if (action === 'confirmOrder' && order.status !== 'pending' || action === 'completeOrder' && order.status !== 'confirmed' || action === 'cancelOrder' && !active(order.status)) throw new Error('当前订单状态不支持此操作')
  if (action !== 'cancelOrder') {
    const product: Product | null = await getProduct(order.productId)
    if (!product || product.status !== 'selling' || product.seller.id !== order.sellerId) throw new Error('商品已不在售，无法继续此订单')
    if (action === 'completeOrder') await setProductStatus(order.productId, 'sold')
  }
  const now = Date.now()
  const updated: MarketOrder = { ...order, status: next, updatedAt: now, completedAt: next === 'completed' ? now : order.completedAt, cancelledAt: next === 'cancelled' ? now : order.cancelledAt }
  saveMockOrders(mockOrders().map(item => item.id === id ? updated : item))
  return updated
}
