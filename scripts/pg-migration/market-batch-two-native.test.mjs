import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

const bin = process.env.REHUB_TEST_PG_BIN
const driver = process.env.REHUB_TEST_PG_DRIVER
const run = promisify(execFile)
const sqlFiles = ['schema.sql', 'transactions.sql', 'market-batch-one.sql', 'market-batch-two.sql', 'market-batch-three.sql', 'market-storage.sql']
const tempPrefix = 'rehub-pg-locks-'

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function withNativePg(check) {
  const require = createRequire(join(resolve(driver), 'package.json'))
  const { Client } = require('pg')
  const tempRoot = await realpath(tmpdir())
  const folder = await mkdtemp(join(tempRoot, tempPrefix))
  const data = join(folder, 'data')
  const clients = []
  let initialized = false
  let started = false
  const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
  const command = (name, args) => run(executable(name), args, { windowsHide: true, timeout: 30000 })
  try {
    const port = await freePort()
    await command('initdb', ['-D', data, '--username=postgres', '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'])
    initialized = true
    await command('pg_ctl', ['-D', data, '-l', join(folder, 'postgres.log'), '-w', '-t', '15',
      '-o', `-h 127.0.0.1 -p ${port}`, 'start'])
    started = true
    async function connect() {
      const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres',
        ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 8000, lock_timeout: 6000 })
      clients.push(client)
      await client.connect()
      return client
    }
    const admin = await connect()
    await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;`)
    for (const file of sqlFiles) await admin.query(await readFile(new URL(file, import.meta.url), 'utf8'))
    const version = (await admin.query('SHOW server_version')).rows[0].server_version
    assert.match(version, /^17\./)
    const a = await connect()
    const b = await connect()
    await a.query('SET ROLE service_role')
    await b.query('SET ROLE service_role')
    await check(admin, a, b)
  } finally {
    await Promise.allSettled(clients.map(client => client.end()))
    if (started) await command('pg_ctl', ['-D', data, '-w', '-m', 'fast', 'stop'])
    else if (initialized) {
      // A failed readiness check can still leave a running child.
      const status = await command('pg_ctl', ['-D', data, 'status']).then(() => true, error => {
        if (error.code === 3) return false
        throw error
      })
      if (status) await command('pg_ctl', ['-D', data, '-w', '-m', 'fast', 'stop'])
    }
    const resolved = await realpath(folder)
    if (dirname(resolved) !== tempRoot || !basename(resolved).startsWith(tempPrefix)) throw new Error('UNSAFE_TEST_DIRECTORY')
    await rm(resolved, { recursive: true, maxRetries: 5, retryDelay: 100 })
  }
}

async function underContention(admin, first, second, firstQuery, secondQuery, beforeCommit) {
  await first.query('BEGIN')
  let waiting
  let committed = false
  try {
    const firstResult = await first.query(...firstQuery)
    waiting = second.query(...secondQuery).then(result => ({ result }), error => ({ error }))
    const deadline = Date.now() + 4000
    let blocked = false
    while (Date.now() < deadline) {
      const { rows } = await admin.query('SELECT $1::int = ANY(pg_blocking_pids($2)) AS blocked', [first.processID, second.processID])
      if (rows[0].blocked) { blocked = true; break }
      await sleep(20)
    }
    assert.equal(blocked, true, 'the independent PostgreSQL session must wait on the first transaction')
    if (beforeCommit) await beforeCommit(first)
    await first.query('COMMIT')
    committed = true
    return [firstResult, await waiting]
  } finally {
    if (!committed) await first.query('ROLLBACK')
    await waiting
  }
}

const place = (buyer, item = 'listing') => ['SELECT public.rehub_create_order($1,$2) AS id', [buyer, item]]
const transition = (order, action) => ['SELECT public.rehub_transition_order($1,$2,$3)', ['seller', order, action]]
const send = (actor, chat, content) => ['SELECT public.rehub_send_message($1,$2,$3)', [actor, chat, content]]
const read = (actor, chat) => ['SELECT public.rehub_mark_conversation_read($1,$2)', [actor, chat]]

test('PostgreSQL 17 独立会话验证订单、聊天、评价和审核的真实锁等待',
  { skip: !bin || !driver, timeout: 90000 }, async () => {
    await withNativePg(async (admin, a, b) => {
      await admin.query(`INSERT INTO public.rehub_users(id,nickname,avatar,school,campus,created_at,updated_at)
        SELECT id,id,'同','测试学校','校内',1,1 FROM unnest(ARRAY['buyer-a','buyer-b','seller','admin']) id;
        INSERT INTO public.rehub_product_refs(id,seller_id)
          SELECT id,'seller' FROM unnest(ARRAY['listing','chat-item','rollback-item','blocked-first','cancelled-first','report-item','audit-lock','seller-lock']) id;
        INSERT INTO public.rehub_products(id,seller_id,title,description,price,category,condition,images,school,status,created_at,updated_at)
          SELECT id,seller_id,'图书','测试数据',5,'books','九成新',ARRAY['fixture'],'测试学校','selling',1,1 FROM public.rehub_product_refs;
        INSERT INTO public.rehub_wechat_identities(app_id,open_id,user_id) VALUES ('wx1111111111111111','admin','admin');
        INSERT INTO public.rehub_admins(id,app_id,open_id,role,enabled,created_at)
          VALUES ('fixture-admin','wx1111111111111111','admin','admin',true,1);`)

      const [placedA, placedB] = await underContention(admin, a, b, place('buyer-a'), place('buyer-b'))
      assert.equal(placedB.error, undefined)
      const idA = placedA.rows[0].id
      const idB = placedB.result.rows[0].id
      assert.notEqual(idA, idB)

      // The order owns the product lock. The seller must be able to wait for it
      // without blocking the order's foreign-key reference to the seller.
      const [, edited] = await underContention(admin, a, b,
        ["SELECT 1 FROM public.rehub_products WHERE id='seller-lock' FOR UPDATE"],
        ["SELECT public.rehub_market_write_product('seller','测试学校','status','seller-lock','',NULL,'offline')"],
        connection => connection.query(...place('buyer-a', 'seller-lock')))
      assert.equal(edited.error, undefined)
      const [, lost] = await underContention(admin, a, b, transition(idA, 'confirm'), transition(idB, 'confirm'))
      assert.equal(lost.error?.message, 'INVALID_ORDER_TRANSITION')
      await a.query(...transition(idA, 'complete'))
      const traded = (await admin.query(`SELECT status, count(*)::int AS count FROM public.rehub_orders
        WHERE product_id='listing' GROUP BY status ORDER BY status`)).rows
      assert.deepEqual(traded, [{ status: 'cancelled', count: 1 }, { status: 'completed', count: 1 }])
      assert.equal((await admin.query(`SELECT status FROM public.rehub_products WHERE id='listing'`)).rows[0].status, 'sold')

      const rate = score => ['SELECT public.rehub_market_create_review($1,$2,$3,$4,$5)', ['buyer-a', idA, score, '', '测试学校']]
      const [, duplicate] = await underContention(admin, a, b, rate(5), rate(1))
      assert.equal(duplicate.error?.message, 'MARKET_ALREADY_REVIEWED')
      assert.deepEqual((await admin.query('SELECT rating FROM public.rehub_reviews')).rows, [{ rating: 5 }])

      const block = item => ['SELECT public.rehub_market_take_down_product($1,$2,$3,$4,$5)',
        ['wx1111111111111111', 'admin', '测试学校', item, '审核下架']]
      const [, queuedBlock] = await underContention(admin, a, b,
        ["SELECT 1 FROM public.rehub_users WHERE id='admin' FOR UPDATE"], block('audit-lock'),
        connection => connection.query("SELECT 1 FROM public.rehub_products WHERE id='audit-lock' FOR UPDATE"))
      assert.equal(queuedBlock.error, undefined)
      for (const item of ['blocked-first', 'cancelled-first']) {
        const id = (await a.query(...place('buyer-a', item))).rows[0].id
        await a.query(...transition(id, 'confirm'))
        const cancel = ['SELECT public.rehub_transition_order($1,$2,$3)', ['buyer-a', id, 'cancel']]
        const pair = item === 'blocked-first' ? [block(item), cancel] : [cancel, block(item)]
        const [, second] = await underContention(admin, a, b, ...pair)
        assert.equal(second.error, undefined)
        const { rows } = await admin.query(`SELECT p.status AS product, p.moderation_status, o.status AS "order", o.seller_unread
          FROM public.rehub_orders o JOIN public.rehub_products p ON p.id=o.product_id WHERE o.id=$1`, [id])
        assert.deepEqual(rows[0], { product: 'offline', moderation_status: 'blocked', order: 'cancelled', seller_unread: true })
      }

      await a.query(`SELECT public.rehub_market_create_report('buyer-a','report-item','测试学校','fraud','')`)
      const reportId = (await admin.query(`SELECT id FROM public.rehub_reports WHERE type='product'`)).rows[0].id
      const resolve = method => ['SELECT public.rehub_market_resolve_report($1,$2,$3,$4,$5)',
        ['wx1111111111111111', 'admin', '测试学校', reportId, method]]
      const [, duplicateResolution] = await underContention(admin, a, b, resolve('takedown'), resolve('dismiss'))
      assert.equal(duplicateResolution.error?.message, 'MARKET_REPORT_HANDLED')
      assert.deepEqual((await admin.query('SELECT status, resolution FROM public.rehub_reports WHERE id=$1', [reportId])).rows,
        [{ status: 'resolved', resolution: 'takedown' }])

      const failedA = (await a.query(...place('buyer-a', 'rollback-item'))).rows[0].id
      const failedB = (await b.query(...place('buyer-b', 'rollback-item'))).rows[0].id
      await admin.query(`UPDATE public.rehub_orders SET active_key='closed_' || $1 WHERE id=$2`, [failedB, idA])
      await assert.rejects(a.query(...transition(failedA, 'confirm')), { code: '23505' })
      assert.deepEqual((await admin.query(`SELECT p.status, count(*)::int AS pending FROM public.rehub_products p
        JOIN public.rehub_orders o ON o.product_id=p.id AND o.status='pending' WHERE p.id='rollback-item' GROUP BY p.status`)).rows,
      [{ status: 'selling', pending: 2 }])

      const chat = (await a.query(`SELECT public.rehub_market_start_chat('buyer-a','chat-item','测试学校') AS id`)).rows[0].id
      const unread = async () => (await admin.query(`SELECT buyer_unread_count AS buyer, seller_unread_count AS seller
        FROM public.rehub_conversations WHERE id=$1`, [chat])).rows[0]
      const [, sent] = await underContention(admin, a, b, send('buyer-a', chat, '买家发送'), send('seller', chat, '卖家发送'))
      assert.equal(sent.error, undefined)
      assert.deepEqual(await unread(), { buyer: 1, seller: 1 })
      const timeline = (await admin.query(`SELECT content FROM public.rehub_messages WHERE conversation_id=$1 ORDER BY created_at`, [chat])).rows
      assert.deepEqual(timeline.map(row => row.content), ['买家发送', '卖家发送'])

      const [, afterRead] = await underContention(admin, a, b, read('buyer-a', chat), send('seller', chat, '已读之后提交'))
      assert.equal(afterRead.error, undefined)
      assert.deepEqual(await unread(), { buyer: 1, seller: 1 })
      const [, afterSend] = await underContention(admin, a, b, send('seller', chat, '已读之前提交'), read('buyer-a', chat))
      assert.equal(afterSend.error, undefined)
      assert.deepEqual(await unread(), { buyer: 0, seller: 1 })
    })
  })
