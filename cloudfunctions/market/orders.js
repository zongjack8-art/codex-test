const { createHash, randomUUID } = require('node:crypto')
const campus = require('./campus.json')
const { fail, safeId, productStatus } = require('./security')

const activeStatuses = ['pending', 'confirmed']
const activeKey = (buyerId, productId) => createHash('sha256').update(`${buyerId}:${productId}`).digest('hex')

function createOrderHandler({ db, users, products, orders, ensureUser }) {
  const _ = db.command
  const one = async (collection, id) => (await collection.where({ _id: safeId(id) }).limit(1).get()).data[0] || null
  const currentOrder = async (id, openid) => {
    const order = await one(orders, id)
    if (!order) fail('NOT_FOUND', '订单不存在')
    if (order.buyerId !== openid && order.sellerId !== openid) fail('FORBIDDEN', '无权查看此订单')
    return order
  }
  async function present(order, openid) {
    const otherId = order.buyerId === openid ? order.sellerId : order.buyerId
    const person = await one(users, otherId)
    return {
      id: order._id, productId: order.productId, buyerId: order.buyerId, sellerId: order.sellerId,
      productTitle: order.productTitle, productImage: order.productImage || '', amount: order.amount,
      status: order.status, createdAt: order.createdAt, updatedAt: order.updatedAt,
      completedAt: order.completedAt || null, cancelledAt: order.cancelledAt || null,
      role: order.buyerId === openid ? 'buyer' : 'seller',
      other: { nickname: person?.nickname || '校园同学', avatar: person?.avatar || '同' }
    }
  }
  const document = async (tx, collection, id) => (await tx.collection(collection).doc(id).get()).data || null

  return async function orderAction(action, event, openid) {
    if (action === 'createOrder') {
      const productId = safeId(event.productId)
      const product = await one(products, productId)
      if (!product || (product.school && product.school !== campus.schoolName)) fail('NOT_FOUND', '商品不存在')
      if (product.sellerId === openid) fail('INVALID_INPUT', '不能购买自己发布的商品')
      if (productStatus(product.status) !== 'selling') fail('INVALID_STATE', '这件商品当前无法发起订单')
      const key = activeKey(openid, productId)
      const existing = await orders.where({ buyerId: openid, productId, status: _.in(activeStatuses) }).limit(1).get()
      if (existing.data.length) fail('INVALID_STATE', '你已经有一笔进行中的订单')
      await ensureUser(openid)
      const now = Date.now()
      const id = `order_${randomUUID().replace(/-/g, '')}`
      try {
        await db.runTransaction(async tx => {
          const live = await document(tx, 'products', productId)
          if (!live || (live.school && live.school !== campus.schoolName) || !live.sellerId || !Number.isFinite(live.price) || live.price <= 0 || live.sellerId === openid || productStatus(live.status) !== 'selling') fail('INVALID_STATE', '商品状态已变化，请刷新后重试')
          await tx.collection('orders').add({ data: {
            _id: id, productId, buyerId: openid, sellerId: live.sellerId,
            productTitle: live.title, productImage: live.images?.[0] || '', amount: live.price,
            activeKey: key, status: 'pending', createdAt: now, updatedAt: now,
            completedAt: null, cancelledAt: null
          } })
        })
      } catch (error) {
        if (error.code) throw error
        const duplicate = await orders.where({ activeKey: key }).limit(1).get()
        if (duplicate.data.length) fail('INVALID_STATE', '你已经有一笔进行中的订单')
        throw error
      }
      return present(await one(orders, id), openid)
    }
    if (action === 'listOrders') {
      if (event.role !== 'buyer' && event.role !== 'seller') fail('INVALID_INPUT', '订单列表类型无效')
      const field = event.role === 'buyer' ? 'buyerId' : 'sellerId'
      const result = await orders.where({ [field]: openid }).orderBy('createdAt', 'desc').limit(100).get()
      return Promise.all(result.data.map(item => present(item, openid)))
    }
    if (action === 'getOrder') return present(await currentOrder(event.id, openid), openid)
    if (['confirmOrder', 'completeOrder', 'cancelOrder'].includes(action)) {
      const id = safeId(event.id)
      await currentOrder(id, openid)
      await db.runTransaction(async tx => {
        const order = await document(tx, 'orders', id)
        if (!order) fail('NOT_FOUND', '订单不存在')
        if (order.buyerId !== openid && order.sellerId !== openid) fail('FORBIDDEN', '无权操作此订单')
        if (action !== 'cancelOrder' && order.sellerId !== openid) fail('FORBIDDEN', '只有卖家可以操作')
        const now = Date.now()
        if (action === 'cancelOrder') {
          if (!activeStatuses.includes(order.status)) fail('INVALID_STATE', '当前订单不能取消')
          await tx.collection('orders').doc(id).update({ data: { status: 'cancelled', activeKey: `closed_${id}`, cancelledAt: now, updatedAt: now } })
          return
        }
        const expected = action === 'confirmOrder' ? 'pending' : 'confirmed'
        if (order.status !== expected) fail('INVALID_STATE', '当前订单状态不支持此操作')
        const product = await document(tx, 'products', order.productId)
        if (!product || product.sellerId !== order.sellerId || productStatus(product.status) !== 'selling') fail('INVALID_STATE', '商品已不在售，无法继续此订单')
        if (action === 'confirmOrder') {
          await tx.collection('orders').doc(id).update({ data: { status: 'confirmed', updatedAt: now } })
        } else {
          await tx.collection('products').doc(order.productId).update({ data: { status: 'sold', updatedAt: now } })
          await tx.collection('orders').doc(id).update({ data: { status: 'completed', activeKey: `closed_${id}`, completedAt: now, updatedAt: now } })
        }
      })
      return present(await one(orders, id), openid)
    }
    fail('INVALID_ACTION', '不支持的订单操作')
  }
}

module.exports = { createOrderHandler, activeKey }
