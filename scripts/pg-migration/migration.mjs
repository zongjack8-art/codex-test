import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const legacyAppId = 'wxdb3e3d718940eae6'
export const backupCounts = Object.freeze({
  users: 10, admins: 1, products: 15, orders: 24, conversations: 13,
  messages: 20, favorites: 5, recentViews: 11, reports: 9, reviews: 1
})

const sha256 = value => createHash('sha256').update(value).digest('hex')

function parseBackup(buffer) {
  const parse = text => JSON.parse(text, (_, value) => {
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) {
      throw new Error('UNSAFE_BACKUP_NUMBER')
    }
    return value
  })
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).trim()
  if (!text) return []
  let parsed
  try { parsed = parse(text) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return text.split(/\r?\n/).filter(line => line.trim()).map(parse)
  }
  return Array.isArray(parsed) ? parsed : [parsed]
}

export async function withBackupCopy(sourceDir, verify) {
  const copyDir = await mkdtemp(join(tmpdir(), 'rehub-pg-backup-'))
  const copied = []
  const checksums = new Map()
  try {
    const snapshot = {}
    for (const [collection, expected] of Object.entries(backupCounts)) {
      const file = `${collection}.json`
      const source = join(sourceDir, file)
      const destination = join(copyDir, file)
      const before = sha256(await readFile(source))
      checksums.set(source, before)
      copied.push(destination)
      await copyFile(source, destination)
      const bytes = await readFile(destination)
      if (sha256(bytes) !== before) throw new Error(`BACKUP_COPY_MISMATCH:${collection}`)
      try { snapshot[collection] = parseBackup(bytes) } catch {
        throw new Error(`INVALID_BACKUP_FORMAT:${collection}`)
      }
      if (snapshot[collection].length !== expected) throw new Error(`BACKUP_COUNT_MISMATCH:${collection}`)
    }
    return await verify(snapshot)
  } finally {
    for (const file of copied) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
    await rmdir(copyDir)
    for (const [source, before] of checksums) {
      if (sha256(await readFile(source)) !== before) throw new Error('SOURCE_BACKUP_CHANGED')
    }
  }
}

const nonempty = value => typeof value === 'string' && value.length > 0 && value.trim() === value

function cleanupKind(row) {
  if (row.type !== 'image_cleanup') return null
  if (row.productId === 'discarded_upload') return 'discarded_upload'
  if (typeof row.productId === 'string' && row.productId.startsWith('avatar:')) return 'avatar'
  return 'product'
}

export function documentId(value) {
  if (nonempty(value)) return value
  if (value && typeof value === 'object' && Object.keys(value).length === 1 &&
      typeof value.$oid === 'string' && /^[0-9a-f]{24}$/i.test(value.$oid)) return value.$oid
  throw new Error('INVALID_DOCUMENT_ID')
}

function fields(row, names) {
  return Object.fromEntries(names.split(' ').map(name => [
    name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), row[name] ?? null
  ]))
}

export function prepareSnapshot(snapshot) {
  const indexed = {}
  const legacyDocuments = []
  for (const collection of Object.keys(backupCounts)) {
    if (!Array.isArray(snapshot[collection])) throw new Error(`MISSING_COLLECTION:${collection}`)
    indexed[collection] = new Map()
    for (const row of snapshot[collection]) {
      const id = documentId(row?._id)
      if (indexed[collection].has(id)) throw new Error(`DUPLICATE_DOCUMENT_ID:${collection}`)
      indexed[collection].set(id, row)
      legacyDocuments.push({ source_app_id: legacyAppId, collection, document_id: id, payload: row })
    }
  }

  const user = openId => {
    if (!nonempty(openId) || !indexed.users.has(openId)) throw new Error('MISSING_LEGACY_USER')
    return `u_${sha256(JSON.stringify([legacyAppId, openId]))}`
  }
  const optionalUser = id => id == null ? null : user(id)
  const map = (collection, convert) => Array.from(indexed[collection], ([id, row]) => convert(id, row))
  const productRefs = new Map(Array.from(indexed.products, ([id, row]) => [id, user(row.sellerId)]))
  const archivedProductRefs = new Set()
  for (const row of indexed.conversations.values()) {
    const productId = documentId(row.productId)
    const sellerId = user(row.sellerId)
    if (productRefs.has(productId) && productRefs.get(productId) !== sellerId) throw new Error('CONVERSATION_SELLER_MISMATCH')
    if (!indexed.products.has(productId)) archivedProductRefs.add(productId)
    productRefs.set(productId, sellerId)
  }
  for (const row of indexed.reports.values()) {
    if (['avatar', 'discarded_upload'].includes(cleanupKind(row))) continue
    const productId = documentId(row.productId)
    if (!productRefs.has(productId)) {
      archivedProductRefs.add(productId)
      productRefs.set(productId, null)
    }
  }

  const tables = {
    rehub_users: map('users', (id, row) => ({ id: user(id), ...fields(row, 'nickname avatar school campus bio createdAt updatedAt') })),
    rehub_wechat_identities: map('users', id => ({ app_id: legacyAppId, open_id: id, user_id: user(id) })),
    rehub_admins: map('admins', (id, row) => {
      user(row.openid)
      return { id, app_id: legacyAppId, open_id: row.openid, ...fields(row, 'role enabled createdAt') }
    }),
    rehub_product_refs: Array.from(productRefs, ([id, seller_id]) => ({ id, seller_id })),
    rehub_products: map('products', (id, row) => ({
      id, seller_id: user(row.sellerId),
      ...fields(row, 'title description price originalPrice category condition images location school createdAt updatedAt moderatedAt moderationReason moderationStatus'),
      moderated_by: optionalUser(row.moderatedBy),
      status: row.status === 'active' || !row.status ? 'selling' : row.status === 'removed' ? 'offline' : row.status
    })),
    rehub_orders: map('orders', (id, row) => ({
      id, buyer_id: user(row.buyerId), seller_id: user(row.sellerId),
      ...fields(row, 'productId productTitle productImage amount activeKey status createdAt updatedAt completedAt cancelledAt reservedAt cancelReason'),
      buyer_unread: row.buyerUnread ?? false, seller_unread: row.sellerUnread ?? false
    })),
    rehub_conversations: map('conversations', (id, row) => {
      const pair = row.participantIds
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.includes(row.buyerId) || !pair.includes(row.sellerId)) {
        throw new Error('CONVERSATION_PARTICIPANT_MISMATCH')
      }
      return {
        id, buyer_id: user(row.buyerId), seller_id: user(row.sellerId),
        ...fields(row, 'productId productSnapshot lastMessage lastMessageAt buyerUnreadCount sellerUnreadCount status createdAt updatedAt')
      }
    }),
    rehub_messages: map('messages', (id, row) => ({
      id, sender_id: user(row.senderId), receiver_id: user(row.receiverId),
      ...fields(row, 'conversationId type content createdAt')
    })),
    rehub_favorites: map('favorites', (id, row) => ({ id, user_id: user(row.userId), ...fields(row, 'productId createdAt') })),
    rehub_recent_views: map('recentViews', (id, row) => ({ id, user_id: user(row.userId), ...fields(row, 'productId school viewedAt') })),
    rehub_reports: map('reports', (id, row) => {
      const kind = cleanupKind(row)
      return {
        id, reporter_id: optionalUser(row.reporterId), resolved_by: optionalUser(row.resolvedBy),
        product_id: kind === 'avatar' || kind === 'discarded_upload' ? null : row.productId,
        file_ids: row.fileIDs ?? null, cleanup_kind: kind,
        cleanup_user_id: kind === 'avatar' ? user(row.productId.slice('avatar:'.length)) : null,
        ...fields(row, 'type reason description school status createdAt updatedAt resolution resolvedAt')
      }
    }),
    rehub_reviews: map('reviews', (id, row) => ({
      id, buyer_id: user(row.buyerId), seller_id: user(row.sellerId),
      ...fields(row, 'orderId productId rating content createdAt school')
    })),
    rehub_legacy_documents: legacyDocuments
  }

  const offlineProducts = new Set(tables.rehub_products.filter(row => row.status === 'offline').map(row => row.id))
  const offlinePendingOrders = tables.rehub_orders.filter(row => row.status === 'pending' && offlineProducts.has(row.product_id)).length
  return { tables, recordCount: legacyDocuments.length, archivedProductRefs: archivedProductRefs.size, offlinePendingOrders }
}

const identifier = name => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('INVALID_SQL_IDENTIFIER')
  return `"${name}"`
}

// One atomic control-plane statement. The local CLI never prints it or writes it to disk.
export function buildImportSql({ tables }) {
  const packed = Buffer.from(JSON.stringify(tables)).toString('base64')
  const names = Object.keys(tables).map(name => `public.${identifier(name)}`)
  const empty = names.map(name => `EXISTS (SELECT 1 FROM ${name})`).join(' OR ')
  const compare = []
  const insert = []
  for (const [name, rows] of Object.entries(tables)) {
    const table = `public.${identifier(name)}`
    const incoming = `import_rows -> '${name}'`
    const comparisons = [`(SELECT count(*) FROM ${table}) <> jsonb_array_length(${incoming})`]
    if (rows.length) {
      const columns = Object.keys(rows[0]).map(identifier).join(', ')
      const input = `SELECT ${columns} FROM jsonb_populate_recordset(NULL::${table}, ${incoming})`
      insert.push(`INSERT INTO ${table} (${columns}) ${input};`)
      comparisons.push(`EXISTS (${input} EXCEPT ALL SELECT ${columns} FROM ${table})`)
    }
    compare.push(`IF ${comparisons.join(' OR ')} THEN RAISE EXCEPTION 'SNAPSHOT_CONFLICT:${name}'; END IF;`)
  }

  return `DO $rehub_import$
DECLARE import_rows jsonb := convert_from(decode('${packed}', 'base64'), 'UTF8')::jsonb;
BEGIN
  LOCK TABLE ${names.join(', ')} IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM public.rehub_legacy_documents) THEN
    IF ${empty} THEN RAISE EXCEPTION 'TARGET_NOT_EMPTY'; END IF;
    ${insert.join('\n    ')}
  END IF;
  ${compare.join('\n  ')}
END;
$rehub_import$;`
}
