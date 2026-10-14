const test = require('node:test')
const assert = require('node:assert/strict')
const { createChatHandler } = require('./chat')
const campus = require('./campus.json')

function fixture() {
  const rows = {
    users: new Map([
      ['buyer', { _id: 'buyer', nickname: '小沐', avatar: '沐' }],
      ['seller', { _id: 'seller', nickname: '林同学', avatar: '林' }]
    ]),
    products: new Map([['product_1', { _id: 'product_1', sellerId: 'seller', school: campus.schoolName, status: 'selling', title: '闲置平板', price: 600, images: ['cloud://example/image.jpg'] }]]),
    conversations: new Map(), messages: new Map()
  }
  let sequence = 0
  const command = { in: values => ({ op: 'in', values }), inc: value => ({ op: 'inc', value }), gte: value => ({ op: 'gte', value }) }
  const db = { command }
  const collection = name => {
    const data = rows[name]
    return {
      where(query) {
        let sortKey = ''
        let descending = false
        let max = Infinity
        let offset = 0
        const matched = () => [...data.values()].filter(row => Object.entries(query).every(([key, expected]) => expected?.op === 'in' ? expected.values.includes(row[key]) : expected?.op === 'gte' ? row[key] >= expected.value : row[key] === expected))
        const cursor = {
          limit(value) { max = value; return cursor },
          skip(value) { offset = value; return cursor },
          orderBy(key, direction) { sortKey = key; descending = direction === 'desc'; return cursor },
          async get() {
            const found = matched()
            if (sortKey) found.sort((a, b) => descending ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey])
            return { data: found.slice(offset, offset + max) }
          },
          async count() { return { total: matched().length } }
        }
        return cursor
      },
      async add({ data: input }) {
        const _id = input._id || `generated_${++sequence}`
        if (data.has(_id)) throw new Error('duplicate id')
        data.set(_id, { ...input, _id })
        return { _id }
      },
      doc(id) {
        return { async update({ data: changes }) {
          const before = data.get(id)
          data.set(id, { ...before, ...Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value?.op === 'inc' ? (before[key] || 0) + value.value : value])) })
        } }
      }
    }
  }
  const chat = createChatHandler({ db, users: collection('users'), products: collection('products'), conversations: collection('conversations'), messages: collection('messages'), ensureUser: async () => rows.users.get('buyer') })
  return { chat, rows }
}

test('买家创建会话并复用，卖家不能和自己聊天，删除商品后保留快照', async () => {
  const { chat, rows } = fixture()
  const first = await chat('startConversation', { productId: 'product_1', buyerId: 'forged' }, 'buyer')
  const again = await chat('startConversation', { productId: 'product_1' }, 'buyer')
  assert.equal(first.id, again.id)
  assert.equal(rows.conversations.size, 1)
  const stored = [...rows.conversations.values()][0]
  assert.equal(stored.buyerId, 'buyer')
  assert.equal(stored.sellerId, 'seller')
  assert.deepEqual(stored.participantIds, ['buyer', 'seller'])
  await assert.rejects(chat('startConversation', { productId: 'product_1' }, 'seller'), error => error.code === 'INVALID_INPUT')
  rows.products.delete('product_1')
  const history = await chat('getConversation', { id: first.id }, 'buyer')
  assert.equal(history.product.title, '闲置平板')
  assert.equal(history.product.status, 'deleted')
})

test('非参与者不能读写消息；发送者与接收者由云端身份决定', async () => {
  const { chat, rows } = fixture()
  const { id } = await chat('startConversation', { productId: 'product_1' }, 'buyer')
  await assert.rejects(chat('getConversation', { id }, 'stranger'), error => error.code === 'FORBIDDEN')
  await assert.rejects(chat('listMessages', { id }, 'stranger'), error => error.code === 'FORBIDDEN')
  await assert.rejects(chat('sendMessage', { id, content: '伪造', senderId: 'seller' }, 'stranger'), error => error.code === 'FORBIDDEN')
  await assert.rejects(chat('markConversationRead', { id }, 'stranger'), error => error.code === 'FORBIDDEN')
  const sent = await chat('sendMessage', { id, content: '请问还在吗？', senderId: 'seller', receiverId: 'stranger' }, 'buyer')
  assert.equal(sent.senderId, 'buyer')
  assert.equal(sent.receiverId, 'seller')
  assert.equal([...rows.messages.values()][0].senderId, 'buyer')
  await assert.rejects(chat('sendMessage', { id, content: '   ' }, 'buyer'), error => error.code === 'INVALID_INPUT')
  await assert.rejects(chat('sendMessage', { id, content: 'x'.repeat(501) }, 'buyer'), error => error.code === 'INVALID_INPUT')
})

test('未读只增加收件人一侧，已读只清空当前参与者一侧', async () => {
  const { chat, rows } = fixture()
  const { id } = await chat('startConversation', { productId: 'product_1' }, 'buyer')
  await chat('sendMessage', { id, content: '你好' }, 'buyer')
  await chat('sendMessage', { id, content: '还在的' }, 'seller')
  await chat('sendMessage', { id, content: '可以校内面交吗？' }, 'buyer')
  assert.equal(rows.conversations.get(id).sellerUnreadCount, 2)
  assert.equal(rows.conversations.get(id).buyerUnreadCount, 1)
  assert.deepEqual(await chat('getUnreadMessageCount', {}, 'seller'), { count: 2 })
  await chat('markConversationRead', { id, buyerUnreadCount: 999, sellerUnreadCount: 999 }, 'seller')
  assert.equal(rows.conversations.get(id).sellerUnreadCount, 0)
  assert.equal(rows.conversations.get(id).buyerUnreadCount, 1)
  assert.equal((await chat('listConversations', {}, 'buyer'))[0].unreadCount, 1)
  await chat('markConversationRead', { id }, 'buyer')
  assert.equal(rows.conversations.get(id).buyerUnreadCount, 0)
})

test('已售或已下架不能新建联系，旧状态可联系且原有聊天仍可查看', async () => {
  const { chat, rows } = fixture()
  const product = rows.products.get('product_1')
  product.status = 'sold'
  await assert.rejects(chat('startConversation', { productId: 'product_1' }, 'buyer'), error => error.code === 'NOT_FOUND')
  product.status = 'offline'
  await assert.rejects(chat('startConversation', { productId: 'product_1' }, 'buyer'), error => error.code === 'NOT_FOUND')
  product.status = 'active'
  const conversation = await chat('startConversation', { productId: 'product_1' }, 'buyer')
  assert.equal(conversation.product.status, 'selling')
  product.status = 'sold'
  const history = await chat('getConversation', { id: conversation.id }, 'buyer')
  assert.equal(history.product.status, 'sold')
  assert.equal((await chat('listMessages', { id: conversation.id }, 'buyer')).length, 0)
  product.status = undefined
  assert.equal((await chat('getConversation', { id: conversation.id }, 'buyer')).product.status, 'selling')
})
