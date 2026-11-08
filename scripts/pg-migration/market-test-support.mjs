import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import market from '../../cloudfunctions/market/pg-market.js'
import { openLocalDatabase } from './local-db.mjs'

const oldApp = 'wxdb3e3d718940eae6'
const newApp = 'wxd07e4ed740dcd392'
const school = '天津师范大学'
const prefix = 'cloud://test-env.test-bucket/'
const jpg = Buffer.from('ffd8ff00', 'hex')
const migrations = await Promise.all(['market-batch-one.sql', 'market-batch-two.sql', 'market-batch-three.sql', 'market-storage.sql']
  .map(name => readFile(new URL(name, import.meta.url), 'utf8')))

function identifier(value) {
  assert.match(value, /^[a-z_]+$/)
  return `"${value}"`
}

// Exercises real SQL and privileges. Only the CloudBase transport and storage are simulated.
function localSdk(db, calls) {
  async function query(text, args, scalar = false) {
    try {
      const result = await db.transaction(async tx => {
        await tx.exec('SET LOCAL ROLE service_role')
        return tx.query(text, args)
      })
      return { data: scalar ? result.rows[0].data : result.rows, error: null }
    } catch (error) {
      return { error: { code: error.code, message: error.message } }
    }
  }

  return {
    rpc(name, params) {
      calls.push(name)
      const args = Object.entries(params)
      return query(`SELECT public.${identifier(name)}(${args.map(([k], i) => `${identifier(k)} => $${i + 1}`).join(',')}) AS data`,
        args.map(([, value]) => value), true)
    },
    from(table) {
      const conditions = [], order = [], args = []
      let columns, limit, offset = 0
      function filter(key, op, value) {
        args.push(value)
        conditions.push(`${identifier(key)} ${op} $${args.length}${op === '= ANY(' ? '::text[])' : ''}`)
        return cursor
      }
      const cursor = {
        select(value) { columns = value.split(',').map(identifier).join(','); return cursor },
        eq(key, value) { return filter(key, '=', value) },
        neq(key, value) { return filter(key, '<>', value) },
        in(key, values) { return filter(key, '= ANY(', values) },
        is(key, value) { assert.equal(value, null); conditions.push(`${identifier(key)} IS NULL`); return cursor },
        order(key, options = {}) {
          order.push(`${identifier(key)} ${options.ascending === false ? 'DESC' : 'ASC'} ${options.nullsFirst ? 'NULLS FIRST' : 'NULLS LAST'}`)
          return cursor
        },
        limit(value) { limit = value; return cursor },
        range(start, end) { offset = start; limit = end - start + 1; return cursor },
        then(resolve, reject) {
          calls.push({ table, limit, offset })
          const text = `SELECT ${columns} FROM public.${identifier(table)}` +
            (conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '') +
            (order.length ? ` ORDER BY ${order.join(',')}` : '') +
            (limit === undefined ? '' : ` LIMIT ${limit} OFFSET ${offset}`)
          return query(text, args).then(resolve, reject)
        }
      }
      return cursor
    }
  }
}

async function withMarket(run, storage = {}) {
  const db = await openLocalDatabase()
  try {
    for (const sql of migrations) await db.exec(sql)
    const calls = [], downloads = [], deletions = [], uploads = []
    const files = new Map()
    let context = { APPID: newApp, OPENID: 'seller' }
    const sdk = localSdk(db, calls)
    const main = market.createPgMarket({
      getDatabase: () => sdk, appIds: [oldApp, newApp], storagePrefix: prefix,
      cloud: {
        getWXContext: () => context,
        async downloadFile({ fileID }) { downloads.push(fileID); return { fileContent: files.get(fileID) } },
        async uploadFile({ cloudPath, fileContent }) {
          uploads.push(cloudPath)
          if (storage.upload) return storage.upload({ cloudPath, fileContent })
          const fileID = prefix + cloudPath
          files.set(fileID, fileContent)
          return { fileID }
        },
        async deleteFile({ fileList }) {
          deletions.push(...fileList)
          if (storage.remove) return storage.remove(fileList)
          for (const fileID of fileList) files.delete(fileID)
          return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) }
        }
      }
    })
    const call = (action, data = {}) => main({ ...data, action })
    async function ok(action, data) {
      const result = await call(action, data)
      assert.equal(result.ok, true, `${action}: ${JSON.stringify(result.error)}`)
      return result.data
    }
    async function rejected(action, data, code) {
      assert.equal((await call(action, data)).error?.code, code, action)
    }
    await run({ db, sdk, calls, files, downloads, deletions, uploads, call, ok, rejected,
      as: (appId, openId, extra) => { context = { APPID: appId, OPENID: openId, ...extra } } })
  } finally { await db.close() }
}

function product(images, extra = {}) {
  return { title: '测试图书', description: '保存完好的样本', price: 20, category: 'books', condition: '九成新',
    images, location: '图书馆门口', ...extra }
}

async function seedProducts(db, actor, count = 105) {
  await db.query(`INSERT INTO public.rehub_product_refs(id, seller_id)
    SELECT 'item-' || n, $1 FROM generate_series(1, $2::int) n`, [actor, count])
  await db.query(`INSERT INTO public.rehub_products(id, seller_id, title, description, price, category, condition, images,
    location, school, status, created_at, updated_at)
    SELECT 'item-' || n, $1, CASE WHEN n = 2 THEN 'Case (100%_book)' ELSE '普通书' END,
      CASE WHEN n = 3 THEN 'Case (100%_book)' ELSE '描述' END, n,
      CASE WHEN n % 2 = 0 THEN 'books' ELSE 'digital' END, '九成新', ARRAY['fixture'], '校内', $2, 'selling', n, n
    FROM generate_series(1, $3::int) n`, [actor, school, count])
}

export { oldApp, newApp, school, prefix, jpg, withMarket, product, seedProducts }
