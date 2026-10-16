import { demoUser } from '../data/mock'
import type { MarketOrder, OrderRole, OrderUnreadSummary, Product } from '../types/market'
import { apiRequest } from './api'
import { ensureUserSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { getProduct, setOrderProductStatus } from './products'
import { readLocal, writeLocal } from './storage'

const ORDERS_KEY = 'campusmarket.orders.v1'
type MockOrder = MarketOrder & { buyerUnread?: boolean; sellerUnread?: boolean; reservedAt?: number }
const mockOrders = () => readLocal<MockOrder[]>(ORDERS_KEY, [])
const saveMockOrders = (orders: MockOrder[]) => writeLocal(ORDERS_KEY, orders)
const active = (status: MarketOrder['status']) => status === 'pending' || status === 'confirmed'
const presentMockOrder = (order: MockOrder, role: OrderRole): MarketOrder => {
  const { buyerUnread, sellerUnread, reservedAt, ...publicOrder } = order
  return { ...publicOrder, role, unread: role === 'buyer' ? buyerUnread === true : sellerUnread === true }
}

export async function getOrderUnreadSummary(): Promise<OrderUnreadSummary> {
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('getOrderUnreadSummary')
  if (mode === 'api') return apiRequest('/me/orders/unread-summary')
  const buyer = mockOrders().filter(order => order.buyerId === demoUser.id && order.buyerUnread === true).length
  const seller = mockOrders().filter(order => order.sellerId === demoUser.id && order.sellerUnread === true).length
  return { buyer, seller, total: buyer + seller }
}

export async function markOrdersRead(role: OrderRole): Promise<{ cleared: number }> {
  if (role !== 'buyer' && role !== 'seller') throw new Error('订单列表类型无效')
  const mode = getDataMode()
  if (mode === 'cloud') return cloudCall('markOrdersRead', { role })
  if (mode === 'api') return apiRequest('/me/orders/read', 'POST', { role })
  const field = role === 'buyer' ? 'buyerUnread' : 'sellerUnread'
  let cleared = 0
  saveMockOrders(mockOrders().map(order => {
    if (order[role === 'buyer' ? 'buyerId' : 'sellerId'] !== demoUser.id || order[field] !== true) return order
    cleared++
    return { ...order, [field]: false }
  }))
  return { cleared }
}

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
  const order: MockOrder = {
    id: `mock-order-${now}-${Math.random().toString(36).slice(2, 8)}`, productId,
    buyerId: demoUser.id, sellerId: product.seller.id,
    productTitle: product.title, productImage: product.images[0] || '', amount: product.price,
    status: 'pending', role: 'buyer', other: { nickname: product.seller.nickname, avatar: product.seller.avatar },
    createdAt: now, updatedAt: now, completedAt: null, cancelledAt: null,
    buyerUnread: false, sellerUnread: true, cancelReason: null
  }
  saveMockOrders([order, ...mockOrders()])
  return presentMockOrder(order, 'buyer')
}

export async function listOrders(role: OrderRole): Promise<MarketOrder[]> {
  if (getDataMode() === 'cloud') return cloudCall('listOrders', { role })
  if (getDataMode() === 'api') return apiRequest(`/me/orders?role=${role}`)
  return mockOrders().filter(order => role === 'buyer' ? order.buyerId === demoUser.id : order.sellerId === demoUser.id).map(order => presentMockOrder(order, role)).sort((a, b) => b.createdAt - a.createdAt)
}

export async function getOrder(id: string): Promise<MarketOrder> {
  if (getDataMode() === 'cloud') return cloudCall('getOrder', { id })
  if (getDataMode() === 'api') return apiRequest(`/me/orders/${encodeURIComponent(id)}`)
  const order = mockOrders().find(item => item.id === id)
  if (!order || (order.buyerId !== demoUser.id && order.sellerId !== demoUser.id)) throw new Error('订单不存在或无权查看')
  return presentMockOrder(order, order.buyerId === demoUser.id ? 'buyer' : 'seller')
}

export async function changeOrder(id: string, action: 'confirmOrder' | 'completeOrder' | 'cancelOrder'): Promise<MarketOrder> {
  if (getDataMode() === 'cloud') return cloudCall(action, { id })
  if (getDataMode() === 'api') return apiRequest(`/me/orders/${encodeURIComponent(id)}/${action}`, 'POST')
  const order = await getOrder(id)
  if (action !== 'cancelOrder' && order.role !== 'seller') throw new Error('只有卖家可以操作')
  const next = action === 'confirmOrder' ? 'confirmed' : action === 'completeOrder' ? 'completed' : 'cancelled'
  if (action === 'confirmOrder' && order.status !== 'pending' || action === 'completeOrder' && order.status !== 'confirmed' || action === 'cancelOrder' && !active(order.status)) throw new Error('当前订单状态不支持此操作')
  const now = Date.now()
  const stored = mockOrders().find(item => item.id === id)
  if (!stored) throw new Error('订单不存在')
  const product: Product | null = await getProduct(order.productId)
  if (action === 'confirmOrder') {
    if (!product || product.status !== 'selling' || product.seller.id !== order.sellerId || mockOrders().some(item => item.productId === order.productId && item.status === 'confirmed')) throw new Error('商品已不在售，无法继续此订单')
    setOrderProductStatus(order.productId, 'selling', 'reserved')
  } else if (action === 'completeOrder') {
    if (!product || product.seller.id !== order.sellerId || product.status !== 'reserved' && !(stored.reservedAt == null && product.status === 'selling')) throw new Error('商品未处于交易中，无法完成订单')
    setOrderProductStatus(order.productId, product.status, 'sold')
  } else if (order.status === 'confirmed' && product?.status === 'reserved' && product.seller.id === order.sellerId) {
    setOrderProductStatus(order.productId, 'reserved', 'selling')
  }
  const notifyBuyer = action !== 'cancelOrder' || order.role === 'seller'
  const updated: MockOrder = {
    ...stored, status: next, updatedAt: now,
    reservedAt: next === 'confirmed' ? now : stored.reservedAt,
    completedAt: next === 'completed' ? now : order.completedAt,
    cancelledAt: next === 'cancelled' ? now : order.cancelledAt,
    cancelReason: null,
    buyerUnread: notifyBuyer, sellerUnread: !notifyBuyer
  }
  saveMockOrders(mockOrders().map(item => item.id === id ? updated : action === 'confirmOrder' && item.productId === order.productId && item.status === 'pending' ? {
    ...item, status: 'cancelled', cancelReason: 'seller_selected_other_buyer',
    cancelledAt: now, updatedAt: now, buyerUnread: true, sellerUnread: false
  } : item))
  return presentMockOrder(updated, order.role)
}
