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
      cancelReason: order.cancelReason || null,
      role: order.buyerId === openid ? 'buyer' : 'seller',
      unread: order.buyerId === openid ? order.buyerUnread === true : order.sellerUnread === true,
      other: { nickname: person?.nickname || '校园同学', avatar: person?.avatar || '同' }
    }
  }
  const document = async (tx, collection, id) => (await tx.collection(collection).doc(id).get()).data || null
  const roleFields = role => {
    if (role !== 'buyer' && role !== 'seller') fail('INVALID_INPUT', '订单列表类型无效')
    return role === 'buyer' ? ['buyerId', 'buyerUnread'] : ['sellerId', 'sellerUnread']
  }
  // Use the existing role + createdAt indexes. Missing flags on older orders are read as false.
  async function eachRoleOrder(role, openid, visit) {
    const [idField] = roleFields(role)
    const pageSize = 100
    for (let offset = 0; ; offset += pageSize) {
      const rows = (await orders.where({ [idField]: openid }).orderBy('createdAt', 'desc').skip(offset).limit(pageSize).get()).data
      for (const row of rows) await visit(row)
      if (rows.length < pageSize) break
    }
  }

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
          // Older confirmed orders may predate the reserved product status.
          const confirmed = (await tx.collection('orders').where({ productId, status: 'confirmed' }).limit(1).get()).data
          if (confirmed.length) fail('INVALID_STATE', '这件商品已有确认中的订单')
          // Both placing and confirming an order write this document. A concurrent
          // confirmation therefore conflicts and retries instead of missing a new pending order.
          await tx.collection('products').doc(productId).update({ data: { updatedAt: now } })
          await tx.collection('orders').add({ data: {
            _id: id, productId, buyerId: openid, sellerId: live.sellerId,
            productTitle: live.title, productImage: live.images?.[0] || '', amount: live.price,
            activeKey: key, status: 'pending', createdAt: now, updatedAt: now,
            completedAt: null, cancelledAt: null, cancelReason: null, buyerUnread: false, sellerUnread: true
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
      const [field] = roleFields(event.role)
      const result = await orders.where({ [field]: openid }).orderBy('createdAt', 'desc').limit(100).get()
      return Promise.all(result.data.map(item => present(item, openid)))
    }
    if (action === 'getOrderUnreadSummary') {
      const summary = { buyer: 0, seller: 0, total: 0 }
      for (const role of ['buyer', 'seller']) {
        const [, unreadField] = roleFields(role)
        await eachRoleOrder(role, openid, row => { if (row[unreadField] === true) summary[role]++ })
      }
      summary.total = summary.buyer + summary.seller
      return summary
    }
    if (action === 'markOrdersRead') {
      const [, unreadField] = roleFields(event.role)
      let cleared = 0
      await eachRoleOrder(event.role, openid, async row => {
        if (row[unreadField] !== true) return
        await orders.doc(row._id).update({ data: { [unreadField]: false } })
        cleared++
      })
      return { cleared }
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
          if (order.status === 'confirmed') {
            const product = await document(tx, 'products', order.productId)
            // A legacy confirmed order may still have a selling product. Never reopen
            // an offline product, especially one taken down by an administrator.
            if (product?.sellerId === order.sellerId && productStatus(product.status) === 'reserved') {
              await tx.collection('products').doc(order.productId).update({ data: { status: 'selling', updatedAt: now } })
            }
          }
          await tx.collection('orders').doc(id).update({ data: {
            status: 'cancelled', activeKey: `closed_${id}`, cancelledAt: now, updatedAt: now,
            cancelReason: null, buyerUnread: order.sellerId === openid, sellerUnread: order.buyerId === openid
          } })
          return
        }
        const expected = action === 'confirmOrder' ? 'pending' : 'confirmed'
        if (order.status !== expected) fail('INVALID_STATE', '当前订单状态不支持此操作')
        const product = await document(tx, 'products', order.productId)
        const status = productStatus(product?.status)
        if (!product || product.sellerId !== order.sellerId) fail('INVALID_STATE', '商品已不可交易')
        if (action === 'confirmOrder') {
          if (status !== 'selling' || product.moderationStatus === 'blocked') fail('INVALID_STATE', '商品已不在售，无法确认订单')
          const confirmed = (await tx.collection('orders').where({ productId: order.productId, status: 'confirmed' }).limit(1).get()).data
          if (confirmed.length) fail('INVALID_STATE', '这件商品已有确认中的订单')
          const pending = []
          for (let offset = 0; ; offset += 100) {
            const batch = (await tx.collection('orders').where({ productId: order.productId, status: 'pending' }).skip(offset).limit(100).get()).data
            pending.push(...batch)
            if (batch.length < 100) break
          }
          await tx.collection('products').doc(order.productId).update({ data: { status: 'reserved', updatedAt: now } })
          await tx.collection('orders').doc(id).update({ data: { status: 'confirmed', reservedAt: now, buyerUnread: true, sellerUnread: false, updatedAt: now } })
          for (const other of pending) {
            if (other._id === id) continue
            await tx.collection('orders').doc(other._id).update({ data: {
              status: 'cancelled', activeKey: `closed_${other._id}`, cancelReason: 'seller_selected_other_buyer',
              cancelledAt: now, updatedAt: now, buyerUnread: true, sellerUnread: false
            } })
          }
        } else {
          // Orders confirmed before reservation was introduced have no reservedAt.
          if (status !== 'reserved' && !(order.reservedAt == null && status === 'selling')) fail('INVALID_STATE', '商品未处于交易中，无法完成订单')
          await tx.collection('products').doc(order.productId).update({ data: { status: 'sold', updatedAt: now } })
          await tx.collection('orders').doc(id).update({ data: { status: 'completed', activeKey: `closed_${id}`, completedAt: now, buyerUnread: true, sellerUnread: false, updatedAt: now } })
        }
      })
      return present(await one(orders, id), openid)
    }
    fail('INVALID_ACTION', '不支持的订单操作')
  }
}

module.exports = { createOrderHandler, activeKey }
