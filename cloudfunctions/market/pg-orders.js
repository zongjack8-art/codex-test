const campus = require('./campus.json')
const { fail, safeId } = require('./security')

const transitions = new Map([
  ['confirmOrder', 'confirm'], ['completeOrder', 'complete'], ['cancelOrder', 'cancel']
])
const orderActions = ['createOrder', 'listOrders', 'getOrder', 'getOrderUnreadSummary', 'markOrdersRead', ...transitions.keys()]

function orderRole(role) {
  if (role !== 'buyer' && role !== 'seller') fail('INVALID_INPUT', '订单列表类型无效')
  return role
}

function otherId(order, actorId) {
  return order.buyer_id === actorId ? order.seller_id : order.buyer_id
}

async function present(store, orders, actorId) {
  const people = await store.people(orders.map(order => otherId(order, actorId)))
  return orders.map(order => {
    const person = people.get(otherId(order, actorId))
    const role = order.buyer_id === actorId ? 'buyer' : 'seller'
    return {
      id: order.id, productId: order.product_id, buyerId: order.buyer_id, sellerId: order.seller_id,
      productTitle: order.product_title, productImage: order.product_image || '', amount: Number(order.amount),
      status: order.status, createdAt: Number(order.created_at), updatedAt: Number(order.updated_at),
      completedAt: Number(order.completed_at) || null, cancelledAt: Number(order.cancelled_at) || null,
      cancelReason: order.cancel_reason || null, role, unread: order[`${role}_unread`] === true,
      other: { nickname: person?.nickname || '校园同学', avatar: person?.avatar || '同' }
    }
  })
}

async function accessible(store, id, actorId) {
  const order = await store.order(id)
  if (!order) fail('NOT_FOUND', '订单不存在')
  if (order.buyer_id !== actorId && order.seller_id !== actorId) fail('FORBIDDEN', '无权查看此订单')
  return order
}

async function pgOrder(store, event, caller, actorId) {
  switch (event.action) {
    case 'createOrder': {
      const productId = safeId(event.productId)
      const product = await store.product(productId)
      if (!product || product.school !== campus.schoolName) fail('NOT_FOUND', '商品不存在')
      if (product.seller_id === actorId) fail('INVALID_INPUT', '不能购买自己发布的商品')
      if (product.status !== 'selling') fail('INVALID_STATE', '这件商品当前无法发起订单')
      if (actorId && await store.activeOrder(actorId, productId)) fail('INVALID_STATE', '你已经有一笔进行中的订单')
      const actor = await store.login(caller)
      const id = await store.transaction('create_order', { p_actor_id: actor.id, p_product_id: productId })
      return (await present(store, [await accessible(store, id, actor.id)], actor.id))[0]
    }
    case 'listOrders': {
      const role = orderRole(event.role)
      return actorId ? present(store, await store.orders(actorId, role), actorId) : []
    }
    case 'getOrderUnreadSummary': return actorId ? store.rpc('order_unread', { p_actor_id: actorId }) : { buyer: 0, seller: 0, total: 0 }
    case 'markOrdersRead': {
      const role = orderRole(event.role)
      return { cleared: actorId ? Number(await store.rpc('mark_orders_read', { p_actor_id: actorId, p_role: role })) : 0 }
    }
    case 'getOrder': return (await present(store, [await accessible(store, safeId(event.id), actorId)], actorId))[0]
    default: {
      const id = safeId(event.id)
      const action = transitions.get(event.action)
      const order = await accessible(store, id, actorId)
      if (action !== 'cancel' && order.seller_id !== actorId) fail('FORBIDDEN', '只有卖家可以操作')
      await store.transaction('transition_order', { p_actor_id: actorId, p_order_id: id, p_action: action })
      return (await present(store, [await accessible(store, id, actorId)], actorId))[0]
    }
  }
}

module.exports = { orderActions, pgOrder }
