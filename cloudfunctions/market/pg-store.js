const campus = require('./campus.json')
const { fail } = require('./security')

const productFields = 'id,seller_id,title,description,price,original_price,category,condition,images,location,school,status,created_at,updated_at,moderation_status,moderation_reason,moderated_at,moderated_by'
const profileFields = 'id,nickname,avatar,campus,bio'
const orderFields = 'id,product_id,buyer_id,seller_id,product_title,product_image,amount,status,created_at,updated_at,completed_at,cancelled_at,cancel_reason,buyer_unread,seller_unread'
const chatFields = 'id,product_id,buyer_id,seller_id,product_snapshot,last_message,last_message_at,buyer_unread_count,seller_unread_count,created_at'
const messageFields = 'id,conversation_id,sender_id,receiver_id,content,created_at'
const reviewFields = 'rating,content,created_at'
const visibleStates = ['selling', 'reserved', 'sold']

const businessErrors = new Map([
  ['MARKET_PRODUCT_MISSING', ['NOT_FOUND', '商品不存在']],
  ['MARKET_PRODUCT_UNAVAILABLE', ['NOT_FOUND', '商品未在售']],
  ['MARKET_VIEW_UNAVAILABLE', ['NOT_FOUND', '商品暂时无法浏览']],
  ['MARKET_NOT_OWNER', ['FORBIDDEN', '只能操作自己发布的商品']],
  ['MARKET_BLOCKED_PRODUCT', ['FORBIDDEN', '管理员下架的商品不能自行重新上架']],
  ['MARKET_VIEW_OWNER', ['FORBIDDEN', '浏览记录归属异常']],
  ['MARKET_PRODUCT_CHANGED', ['INVALID_STATE', '商品状态已变化，请刷新后重试']],
  ['MARKET_PRODUCT_STATUS', ['INVALID_STATE', '当前商品状态不支持此操作']],
  ['MARKET_PUBLISH_LIMIT', ['RATE_LIMITED', '每天最多发布 20 件商品']],
  ['MARKET_FAVORITE_LIMIT', ['RATE_LIMITED', '收藏数量已达上限']],
  ['INVALID_CONFIRMED_ORDER_PRODUCT', ['INVALID_STATE', '请先处理进行中的订单']],
  ['INVALID_PRODUCT_TRANSITION', ['INVALID_STATE', '当前商品状态不支持此操作']],
  ['PRODUCT_NOT_ORDERABLE', ['INVALID_STATE', '商品状态已变化，请刷新后重试']],
  ['ORDER_ALREADY_ACTIVE', ['INVALID_STATE', '你已经有一笔进行中的订单']],
  ['ORDER_ALREADY_CONFIRMED', ['INVALID_STATE', '这件商品已有确认中的订单']],
  ['MARKET_ORDER_MISSING', ['NOT_FOUND', '订单不存在']],
  ['MARKET_ORDER_FORBIDDEN', ['FORBIDDEN', '无权操作此订单']],
  ['MARKET_ORDER_SELLER_ONLY', ['FORBIDDEN', '只有卖家可以操作']],
  ['MARKET_ORDER_CANCEL_STATE', ['INVALID_STATE', '当前订单不能取消']],
  ['INVALID_ORDER_TRANSITION', ['INVALID_STATE', '当前订单状态不支持此操作']],
  ['MARKET_ORDER_PRODUCT_GONE', ['INVALID_STATE', '商品已不可交易']],
  ['MARKET_ORDER_CONFIRM_STATE', ['INVALID_STATE', '商品已不在售，无法确认订单']],
  ['MARKET_ORDER_COMPLETE_STATE', ['INVALID_STATE', '商品未处于交易中，无法完成订单']],
  ['MARKET_CHAT_MISSING', ['NOT_FOUND', '会话不存在']],
  ['MARKET_CHAT_FORBIDDEN', ['FORBIDDEN', '无权查看此会话']],
  ['MARKET_CHAT_UNAVAILABLE', ['NOT_FOUND', '这件商品当前无法联系卖家']],
  ['MARKET_CHAT_SELF', ['INVALID_INPUT', '不能给自己发送消息']],
  ['MARKET_CHAT_CURSOR', ['INVALID_INPUT', '消息分页游标无效']],
  ['MESSAGE_RATE_LIMIT', ['RATE_LIMITED', '发送太频繁，请稍后再试']],
  ['MARKET_REVIEW_FORBIDDEN', ['FORBIDDEN', '无权查看此订单']],
  ['MARKET_REVIEW_BUYER_ONLY', ['FORBIDDEN', '只有订单买家可以评价卖家']],
  ['MARKET_REVIEW_NOT_COMPLETE', ['INVALID_STATE', '完成交易后才可以评价']],
  ['MARKET_ALREADY_REVIEWED', ['ALREADY_REVIEWED', '这笔订单已经评价过了']],
  ['MARKET_REPORT_SELF', ['INVALID_INPUT', '不能举报自己的商品']],
  ['MARKET_REPORT_LIMIT', ['RATE_LIMITED', '今日举报次数已达上限']],
  ['MARKET_REPORT_MISSING', ['NOT_FOUND', '举报不存在']],
  ['MARKET_REPORT_HANDLED', ['INVALID_STATE', '举报已经处理']],
  ['MARKET_REPORT_OTHER_SCHOOL', ['FORBIDDEN', '不能处理其他学校的商品']],
  ['MARKET_ADMIN_REQUIRED', ['FORBIDDEN', '没有管理员权限']],
  ['MARKET_ALREADY_BLOCKED', ['INVALID_STATE', '商品已由管理员下架']]
])

async function checked(request) {
  let result
  try { result = await request } catch { throw new Error('PG_MARKET_REQUEST_FAILED') }
  if (result.error) {
    const business = businessErrors.get(result.error.message)
    if (business) fail(...business)
    throw new Error('PG_MARKET_REQUEST_FAILED')
  }
  return result.data
}

function publicUser(row) {
  return { id: row.id, nickname: row.nickname, avatar: row.avatar, school: campus.schoolName, campus: row.campus, bio: row.bio || '' }
}

function listing(row, seller, publicCard = false) {
  const base = {
    _id: row.id, title: row.title, description: row.description, price: Number(row.price),
    originalPrice: row.original_price == null ? null : Number(row.original_price),
    category: row.category, condition: row.condition, images: row.images,
    location: row.location ?? undefined, status: row.status,
    createdAt: row.created_at == null ? undefined : Number(row.created_at), updatedAt: Number(row.updated_at)
  }
  if (publicCard) return { ...base, seller: { id: '', nickname: seller.nickname, avatar: seller.avatar, school: campus.schoolName, campus: seller.campus } }
  return {
    ...base, sellerId: row.seller_id, school: row.school, seller,
    ...(row.moderation_status == null ? {} : { moderationStatus: row.moderation_status }),
    ...(row.moderation_reason == null ? {} : { moderationReason: row.moderation_reason }),
    ...(row.moderated_by == null ? {} : { moderatedBy: row.moderated_by }),
    ...(row.moderated_at == null ? {} : { moderatedAt: Number(row.moderated_at) })
  }
}

function createPgStore(db) {
  const products = () => db.from('rehub_products').select(productFields)
  const rpc = (name, params) => checked(db.rpc(`rehub_market_${name}`, params))
  const transaction = (name, params) => checked(db.rpc(`rehub_${name}`, params))
  const orderRows = () => db.from('rehub_orders').select(orderFields)
  const chatRows = () => db.from('rehub_conversations').select(chatFields)
  const first = async request => (await checked(request.limit(1)))[0] || null

  async function people(ids) {
    const unique = [...new Set(ids)]
    const found = new Map()
    for (let offset = 0; offset < unique.length; offset += 50) {
      const rows = await checked(db.from('rehub_users').select(profileFields).in('id', unique.slice(offset, offset + 50)))
      for (const row of rows) found.set(row.id, publicUser(row))
    }
    return found
  }

  async function render(items, publicCard = false) {
    const sellers = await people(items.map(row => row.seller_id))
    return items.map(row => listing(row, sellers.get(row.seller_id) || {
      id: row.seller_id, nickname: '校园同学', avatar: '同', school: campus.schoolName, campus: campus.campusName
    }, publicCard))
  }

  async function renderByIds(ids, limit) {
    const items = []
    for (let offset = 0; offset < ids.length && items.length < limit; offset += 50) {
      const batch = ids.slice(offset, offset + 50)
      const rows = await checked(products().in('id', batch).eq('school', campus.schoolName)
        .in('status', visibleStates).is('moderation_status', null))
      const byId = new Map(rows.map(row => [row.id, row]))
      items.push(...batch.map(id => byId.get(id)).filter(Boolean))
    }
    return render(items.slice(0, limit), true)
  }

  return {
    rpc,
    transaction,
    people,
    render,
    order(id) { return first(orderRows().eq('id', id)) },
    orders(actorId, role) {
      return checked(orderRows().eq(`${role}_id`, actorId).order('created_at', { ascending: false }).order('id').limit(100))
    },
    activeOrder(actorId, productId) {
      return first(db.from('rehub_orders').select('id').eq('buyer_id', actorId).eq('product_id', productId).in('status', ['pending', 'confirmed']))
    },
    chat(id) { return first(chatRows().eq('id', id)) },
    chats(actorId, role) {
      return checked(chatRows().eq(`${role}_id`, actorId).order('last_message_at', { ascending: false }).order('id').limit(50))
    },
    productCards(ids) {
      return ids.length ? checked(db.from('rehub_products').select('id,title,price,images,status,seller_id')
        .in('id', [...new Set(ids)]).neq('status', 'deleted')) : []
    },
    sellerReviews(sellerId) {
      return checked(db.from('rehub_reviews').select(reviewFields).eq('school', campus.schoolName)
        .eq('seller_id', sellerId).order('created_at', { ascending: false }).order('id').limit(20))
    },
    orderReview(orderId) {
      return first(db.from('rehub_reviews').select(reviewFields).eq('school', campus.schoolName).eq('order_id', orderId))
    },
    adminProducts() {
      return checked(products().eq('school', campus.schoolName).neq('status', 'deleted')
        .order('created_at', { ascending: false, nullsFirst: false }).order('id').limit(100))
    },
    message(id, chatId) {
      return first(db.from('rehub_messages').select(messageFields).eq('id', id).eq('conversation_id', chatId))
    },
    async actor({ appId, openId }) {
      const rows = await checked(db.from('rehub_wechat_identities').select('user_id')
        .eq('app_id', appId).eq('open_id', openId).limit(1))
      return rows[0]?.user_id
    },
    login({ appId, openId }) {
      return rpc('login', { p_app_id: appId, p_open_id: openId, p_school: campus.schoolName, p_campus: campus.campusName })
    },
    async product(id) {
      const rows = await checked(products().eq('id', id).neq('status', 'deleted').limit(1))
      return rows[0] || null
    },
    async listProducts({ category, keyword, minPrice, maxPrice, sort }) {
      const items = await rpc('search', {
        p_school: campus.schoolName, p_category: category ?? null, p_keyword: keyword,
        p_min_price: minPrice ?? null, p_max_price: maxPrice ?? null, p_sort: sort
      })
      return render(items, true)
    },
    async myProducts(actorId) {
      const items = []
      for (let offset = 0; ; offset += 100) {
        const rows = await checked(products().eq('seller_id', actorId).neq('status', 'deleted')
          .order('created_at', { ascending: false, nullsFirst: false }).order('id').range(offset, offset + 99))
        items.push(...rows)
        if (rows.length < 100) break
      }
      return render(items)
    },
    async favoriteIds(actorId) {
      const rows = await checked(db.from('rehub_favorites').select('product_id').eq('user_id', actorId)
        .order('created_at', { ascending: false, nullsFirst: false }).order('id').limit(500))
      return rows.map(row => row.product_id)
    },
    favorites(ids) { return renderByIds(ids, 50) },
    async recentViews(actorId) {
      const rows = await checked(db.from('rehub_recent_views').select('product_id')
        .eq('user_id', actorId).eq('school', campus.schoolName).order('viewed_at', { ascending: false }).order('id').limit(50))
      return renderByIds(rows.map(row => row.product_id), 50)
    }
  }
}

module.exports = { createPgStore, publicUser }
