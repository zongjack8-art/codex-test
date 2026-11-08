import assert from 'node:assert/strict'
import test from 'node:test'
import { backupCounts, buildImportSql, legacyAppId, prepareSnapshot, withBackupCopy } from './migration.mjs'
import { openLocalDatabase, safeFailure } from './local-db.mjs'

const newAppId = 'wxd07e4ed740dcd392'
const school = '迁移测试学校'
const timestamps = { createdAt: 1000, updatedAt: 2000 }

function fixture() {
  const order = { productId: 'listing', sellerId: 'seller', productTitle: '示例图书', productImage: 'fixture-image', amount: 5,
    ...timestamps, completedAt: null, cancelledAt: null }
  const product = { sellerId: 'seller', title: order.productTitle, description: '合成测试数据', price: 5, category: 'books',
    condition: '九成新', images: [order.productImage], school, ...timestamps }
  return {
    users: ['seller', 'buyer', 'other-buyer', 'outsider'].map(id => ({ _id: id, nickname: id, avatar: '同', school,
      campus: '校内', bio: '', ...timestamps })),
    admins: [{ _id: 'admin', openid: 'seller', role: 'admin', enabled: true, createdAt: 1000 }],
    products: [{ ...product, _id: 'listing', status: 'active' }, { ...product, _id: 'offline-listing', status: 'offline' }],
    orders: [
      { ...order, _id: 'order-a', buyerId: 'buyer', activeKey: 'active-a', status: 'pending' },
      { ...order, _id: 'order-b', buyerId: 'other-buyer', activeKey: 'active-b', status: 'pending' },
      { ...order, _id: 'order-offline', buyerId: 'buyer', productId: 'offline-listing', activeKey: 'active-c', status: 'pending' },
      { ...order, _id: 'order-done', buyerId: 'buyer', activeKey: 'closed_order-done', status: 'completed', completedAt: 2000 }
    ],
    conversations: [{ _id: 'chat', buyerId: 'buyer', sellerId: 'seller', participantIds: ['buyer', 'seller'],
      productId: 'removed-listing', productSnapshot: { title: '已删除的测试商品' }, lastMessage: '旧消息', lastMessageAt: 2000,
      buyerUnreadCount: 2, sellerUnreadCount: 3, status: 'active', ...timestamps }],
    messages: [{ _id: 'message', conversationId: 'chat', senderId: 'seller', receiverId: 'buyer', type: 'text',
      content: '旧消息', createdAt: 2000 }],
    favorites: [{ _id: 'favorite', userId: 'buyer', productId: 'listing', createdAt: 1000 }],
    recentViews: [{ _id: 'view', userId: 'buyer', productId: 'listing', school, viewedAt: 1000 }],
    reports: [
      { _id: 'report', type: 'product', reporterId: 'buyer', productId: 'listing', reason: 'other',
        description: '', school, status: 'pending', ...timestamps },
      { _id: 'cleanup', type: 'image_cleanup', productId: 'avatar:seller', reason: '模拟清理失败',
        fileIDs: ['fixture-image'], school, status: 'pending', ...timestamps }
    ],
    reviews: [{ _id: { $oid: 'a'.repeat(24) }, orderId: 'order-done', productId: 'listing', buyerId: 'buyer',
      sellerId: 'seller', rating: 5, content: '', school, createdAt: 2000 }]
  }
}

async function withFixture(run, snapshot = fixture()) {
  const db = await openLocalDatabase()
  try {
    const plan = prepareSnapshot(snapshot)
    const sql = buildImportSql(plan)
    await db.exec(sql)
    const identity = Object.fromEntries(plan.tables.rehub_wechat_identities.map(x => [x.open_id, x.user_id]))
    await run(db, identity, sql)
  } finally { await db.close() }
}

const row = async (db, sql, args) => (await db.query(sql, args)).rows[0]

async function asRole(db, role, run) {
  await db.exec(`SET ROLE ${role}`)
  try { await run() } finally { await db.exec('RESET ROLE') }
}

test('相同快照复跑无变化，源文档或目标行变化时拒绝覆盖', async () => {
  await withFixture(async (db, identity, sql) => {
    await db.exec(sql)
    const changed = fixture()
    changed.users[0].nickname = '另一个昵称'
    await assert.rejects(db.exec(buildImportSql(prepareSnapshot(changed))), /SNAPSHOT_CONFLICT:rehub_users/)
    await db.query('UPDATE public.rehub_users SET nickname = $1 WHERE id = $2', ['目标已变更', identity.seller])
    await assert.rejects(db.exec(sql), /SNAPSHOT_CONFLICT:rehub_users/)
    assert.equal((await row(db, 'SELECT nickname FROM public.rehub_users WHERE id = $1', [identity.seller])).nickname, '目标已变更')
  })
})

test('新 AppID 不继承用户或管理员，RPC 即使获准执行也核对数据库角色', async () => {
  await withFixture(async (db, identity) => {
    assert.deepEqual(await row(db, `SELECT
      (SELECT count(*)::int FROM public.rehub_wechat_identities WHERE app_id = $1) AS new_count,
      (SELECT count(*)::int FROM public.rehub_admins WHERE app_id = $2 AND open_id = 'seller' AND enabled) AS old_admin`,
    [newAppId, legacyAppId]), { new_count: 0, old_admin: 1 })
    await db.query(`INSERT INTO public.rehub_users(id, nickname, avatar, school, campus, created_at, updated_at)
      VALUES ('new-user', '新用户', '同', $1, '校内', 1, 1)`, [school])
    await db.query(`INSERT INTO public.rehub_wechat_identities VALUES ($1, 'seller', 'new-user')`, [newAppId])
    assert.equal((await row(db, 'SELECT count(*)::int AS count FROM public.rehub_admins WHERE app_id = $1', [newAppId])).count, 0)
    await asRole(db, 'service_role', async () => {
      await assert.rejects(db.query(`SELECT public.rehub_transition_order('new-user', 'order-a', 'confirm')`), { code: '42501' })
      await assert.rejects(db.query('SELECT payload FROM public.rehub_legacy_documents'), { code: '42501' })
    })
    assert.notEqual(identity.seller, 'new-user')
    await db.exec('GRANT EXECUTE ON FUNCTION public.rehub_transition_order(text, text, text) TO anon')
    await asRole(db, 'anon', async () => {
      await assert.rejects(db.query('SELECT id FROM public.rehub_users'), { code: '42501' })
      await assert.rejects(db.query(`SELECT public.rehub_transition_order($1, 'order-a', 'confirm')`, [identity.seller]), { code: '42501' })
    })
  })
})

test('保留缺商品会话和快照，消息与评价关系由外键保护', async () => {
  await withFixture(async (db, identity) => {
    assert.deepEqual(await row(db, `SELECT c.product_snapshot->>'title' AS title,
      (SELECT count(*)::int FROM public.rehub_messages WHERE conversation_id = c.id) AS messages,
      p.id IS NULL AS archived FROM public.rehub_conversations c LEFT JOIN public.rehub_products p ON p.id = c.product_id`),
    { title: '已删除的测试商品', messages: 1, archived: true })
    assert.deepEqual(await row(db, `SELECT product_id, cleanup_kind, cleanup_user_id FROM public.rehub_reports WHERE id = 'cleanup'`),
      { product_id: null, cleanup_kind: 'avatar', cleanup_user_id: identity.seller })
    await assert.rejects(db.query(`INSERT INTO public.rehub_messages(id, conversation_id, sender_id, receiver_id, type, content, created_at)
      VALUES ('invalid', 'chat', $1, $2, 'text', '模拟越权', 1)`, [identity.buyer, identity.outsider]), { code: '23503' })
    await assert.rejects(db.query(`UPDATE public.rehub_conversations SET seller_id = $1 WHERE id = 'chat'`,
      [identity.outsider]), { code: '23503' })
    await assert.rejects(db.query(`INSERT INTO public.rehub_reviews(id, order_id, product_id, buyer_id, seller_id, rating, content, created_at, school)
      VALUES ('invalid', 'order-a', 'listing', $1, $2, 5, '', 1, $3)`, [identity.buyer, identity.seller, school]), { code: '23503' })
  })
})

test('坏引用使导入事务全部回滚，非空目标拒绝导入', async () => {
  const db = await openLocalDatabase()
  try {
    const invalid = fixture()
    invalid.messages[0].receiverId = 'outsider'
    await assert.rejects(db.exec(buildImportSql(prepareSnapshot(invalid))), { code: '23503' })
    assert.deepEqual(await row(db, `SELECT (SELECT count(*)::int FROM public.rehub_users) AS users,
      (SELECT count(*)::int FROM public.rehub_legacy_documents) AS documents`), { users: 0, documents: 0 })
    await db.exec(`INSERT INTO public.rehub_product_refs(id) VALUES ('existing')`)
    await assert.rejects(db.exec(buildImportSql(prepareSnapshot(fixture()))), /TARGET_NOT_EMPTY/)
  } finally { await db.close() }
})

test('订单和商品联动，拒绝重复下单和确认，保留下架订单的取消能力', async () => {
  await withFixture(async (db, id) => {
    const transition = (actor, order, action) => db.query('SELECT public.rehub_transition_order($1, $2, $3)', [actor, order, action])
    await assert.rejects(db.query(`UPDATE public.rehub_products SET status = 'reserved' WHERE id = 'listing'`), /INVALID_RESERVATION/)
    await asRole(db, 'service_role', async () => {
      await assert.rejects(db.query(`SELECT public.rehub_create_order($1, 'listing')`, [id.buyer]), { code: '23505' })
      await assert.rejects(db.query(`SELECT public.rehub_create_order($1, 'offline-listing')`, [id.outsider]), /PRODUCT_NOT_ORDERABLE/)
      const created = await row(db, `SELECT public.rehub_create_order($1, 'listing') AS id`, [id.outsider])
      assert.deepEqual(await row(db, 'SELECT buyer_id, seller_id, seller_unread FROM public.rehub_orders WHERE id = $1', [created.id]),
        { buyer_id: id.outsider, seller_id: id.seller, seller_unread: true })
      await assert.rejects(transition(id.buyer, 'order-a', 'confirm'), { code: '42501' })
      await transition(id.seller, 'order-a', 'confirm')
      await assert.rejects(transition(id.seller, 'order-b', 'confirm'), /INVALID_ORDER_TRANSITION/)
      assert.deepEqual(await row(db, `SELECT status, cancel_reason, buyer_unread FROM public.rehub_orders WHERE id = 'order-b'`),
        { status: 'cancelled', cancel_reason: 'seller_selected_other_buyer', buyer_unread: true })
      await transition(id.seller, 'order-a', 'complete')
      await transition(id.buyer, 'order-offline', 'cancel')
    })
    assert.equal((await row(db, `SELECT status FROM public.rehub_products WHERE id = 'listing'`)).status, 'sold')
    assert.equal((await row(db, `SELECT status FROM public.rehub_products WHERE id = 'offline-listing'`)).status, 'offline')
    await assert.rejects(db.query(`UPDATE public.rehub_products SET status = 'selling' WHERE id = 'listing'`), /INVALID_PRODUCT_TRANSITION/)
    await assert.rejects(db.query(`UPDATE public.rehub_products SET status = 'offline' WHERE id = 'listing'`), /INVALID_PRODUCT_TRANSITION/)
    await db.query(`UPDATE public.rehub_products SET status = 'offline', moderation_status = 'blocked' WHERE id = 'listing'`)
    await assert.rejects(db.query(`UPDATE public.rehub_products SET status = 'selling' WHERE id = 'listing'`), { code: '23514' })
  })
})

test('确认订单中途失败时商品、胜出订单和竞争订单一起回滚', async () => {
  await withFixture(async (db, id) => {
    await db.query(`UPDATE public.rehub_orders SET active_key = 'closed_order-b' WHERE id = 'order-done'`)
    await asRole(db, 'service_role', () => assert.rejects(
      db.query(`SELECT public.rehub_transition_order($1, 'order-a', 'confirm')`, [id.seller]), { code: '23505' }))
    assert.deepEqual(await row(db, `SELECT p.status, count(*)::int AS pending FROM public.rehub_products p
      JOIN public.rehub_orders o ON o.product_id = p.id AND o.status = 'pending' WHERE p.id = 'listing' GROUP BY p.status`),
    { status: 'selling', pending: 2 })
  })
})

test('发消息只增加收件方未读，标记已读只清自己的计数', async () => {
  await withFixture(async (db, id) => {
    await asRole(db, 'service_role', async () => {
      await assert.rejects(db.query(`SELECT public.rehub_send_message($1, 'chat', '越权')`, [id.outsider]), { code: '42501' })
      await assert.rejects(db.query(`SELECT public.rehub_send_message($1, 'chat', $2)`, [id.buyer, ' \t ']), { code: '23514' })
      await db.query(`SELECT public.rehub_send_message($1, 'chat', ' 新消息 ')`, [id.buyer])
      await db.query(`SELECT public.rehub_mark_conversation_read($1, 'chat')`, [id.buyer])
    })
    assert.deepEqual(await row(db, `SELECT buyer_unread_count, seller_unread_count, last_message FROM public.rehub_conversations`),
      { buyer_unread_count: 0, seller_unread_count: 4, last_message: '新消息' })
    assert.equal((await row(db, 'SELECT count(*)::int AS count FROM public.rehub_messages')).count, 2)
  })
})

const backupDir = process.env.REHUB_TEST_BACKUP_DIR
test('实际备份副本的 109 条记录及关联可重复导入', { skip: !backupDir }, async () => {
  try {
    await withBackupCopy(backupDir, async snapshot => {
      const plan = prepareSnapshot(snapshot)
      assert.equal(plan.recordCount, 109)
      assert.equal(plan.archivedProductRefs, 1)
      assert.equal(plan.offlinePendingOrders, 2)
      await withFixture(async (db, _, sql) => {
        await db.exec(sql)
        const counts = (await db.query(`SELECT collection, count(*)::int AS count FROM public.rehub_legacy_documents GROUP BY collection`)).rows
        assert.deepEqual(Object.fromEntries(counts.map(x => [x.collection, x.count])), backupCounts)
        assert.deepEqual(await row(db, `SELECT
          (SELECT count(*)::int FROM public.rehub_wechat_identities WHERE app_id = $1) AS old,
          (SELECT count(*)::int FROM public.rehub_wechat_identities WHERE app_id <> $1) AS other,
          (SELECT count(*)::int FROM public.rehub_reviews r JOIN public.rehub_legacy_documents d
            ON d.collection = 'reviews' AND r.id = d.payload->'_id'->>'$oid') AS review_id_preserved,
          (SELECT count(*)::int FROM public.rehub_messages m JOIN public.rehub_conversations c ON c.id = m.conversation_id
            LEFT JOIN public.rehub_products p ON p.id = c.product_id WHERE p.id IS NULL) AS archived_messages`, [legacyAppId]),
        { old: 10, other: 0, review_id_preserved: 1, archived_messages: 2 })
      }, snapshot)
    })
  } catch (error) { throw new Error(safeFailure(error)) }
})
