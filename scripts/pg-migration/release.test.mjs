import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import orders from '../../cloudfunctions/market/pg-orders.js'
import chat from '../../cloudfunctions/market/pg-chat.js'
import reviews from '../../cloudfunctions/market/pg-reviews.js'
import moderation from '../../cloudfunctions/market/pg-moderation.js'
import { deploymentBody } from './deployment-schema.mjs'
import { openLocalDatabase, safeFailure } from './local-db.mjs'
import { buildImportSql, prepareSnapshot, withBackupCopy } from './migration.mjs'

const root = new URL('../../', import.meta.url)
const market = new URL('cloudfunctions/market/', root)
const read = (folder, filename) => readFile(new URL(filename, folder), 'utf8')
const quoted = source => [...source.matchAll(/'([^']+)'/g)].map(match => match[1])
const sorted = values => [...values].sort()

test('独立联调入口缺少显式 PostgreSQL 开关时拒绝调用', async () => {
  const entry = await read(market, 'pg-preview.js')
  for (const env of [{}, { REHUB_MARKET_BACKEND: 'legacy' }]) {
    const exports = {}
    runInNewContext(entry, { process: { env }, exports, require: () => assert.fail('preview loaded a backend') })
    assert.equal((await exports.main({ action: 'login' })).error.code, 'SERVER_ERROR')
  }
})

test('19 页的 43 个 action 与旧入口和 PG 分发一一对应', async () => {
  const [legacy, pg, appConfig] = await Promise.all([read(market, 'index.js'), read(market, 'pg-market.js'), read(root, 'src/app.config.ts')])
  const delegated = [...legacy.matchAll(/const \w+Actions = new Set\(\[([^\]]+)\]/g)].flatMap(match => quoted(match[1]))
  const direct = [...legacy.matchAll(/action === '([^']+)'/g)].map(match => match[1])
  const base = quoted(pg.match(/const actions = new Set\(\[([\s\S]+?)\]\)/)[1])
  const pgActions = [...base, ...orders.orderActions, ...chat.chatActions, ...reviews.reviewActions, ...moderation.moderationActions]
  assert.equal(pgActions.length, 43)
  assert.equal(new Set(pgActions).size, 43)
  assert.deepEqual(sorted(pgActions), sorted(new Set([...direct, ...delegated])))

  const services = new URL('src/services/', root)
  const clientActions = new Set()
  for (const filename of (await readdir(services)).filter(name => name.endsWith('.ts'))) {
    const file = ts.createSourceFile(filename, await read(services, filename), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isCallExpression(node) && ['cloudCall', 'adminCall'].includes(node.expression.getText(file))) {
        const action = node.arguments[0]
        if (ts.isStringLiteral(action)) clientActions.add(action.text)
        else if (filename === 'orders.ts' && action.getText(file) === 'action') {
          assert.match(file.text, /action: 'confirmOrder' \| 'completeOrder' \| 'cancelOrder'/)
          for (const name of ['confirmOrder', 'completeOrder', 'cancelOrder']) clientActions.add(name)
        } else assert.equal(filename === 'admin.ts' && action.getText(file) === 'action', true, filename)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  assert.deepEqual(sorted(clientActions), sorted(pgActions))
  const pages = quoted(appConfig.match(/pages:\s*\[([^\]]+)\]/)[1])
  assert.equal(new Set(pages).size, 19)
  await Promise.all(pages.map(page => access(new URL(`src/${page}.tsx`, root))))
})

test('部署包支持事务回滚和重放拦截，表、索引、RPC 和角色与代码相符', async t => {
  const body = await deploymentBody()
  t.diagnostic(`DDL SHA-256 ${createHash('sha256').update(body).digest('hex')}`)
  const db = await openLocalDatabase({ empty: true })
  const execute = sql => db.exec(`BEGIN;\n${sql}\nCOMMIT;`)
  try {
    await assert.rejects(execute(`${body}\nSELECT * FROM public.rehub_injected_missing_relation;`), { code: '42P01' })
    await db.exec('ROLLBACK')
    assert.equal((await db.query("SELECT to_regclass('public.rehub_orders') AS name")).rows[0].name, null)

    const probe = await read(new URL('../pg-compat/', import.meta.url), 'probe.sql')
    await db.exec(probe)
    await db.exec(`GRANT EXECUTE ON FUNCTION public.rehub_pg_compat_check() TO anon; SET ROLE anon;`)
    await assert.rejects(db.query('SELECT public.rehub_pg_compat_check()'), { code: '42501' })
    await db.exec('RESET ROLE; SET ROLE service_role;')
    assert.equal((await db.query('SELECT public.rehub_pg_compat_check() AS value')).rows[0].value, 1)
    await db.exec('RESET ROLE')
    await execute(body)
    await assert.rejects(execute(body), /REHUB_RELEASE_SCHEMA_ALREADY_PRESENT/)
    await db.exec('ROLLBACK')

    const files = (await readdir(market)).filter(name => name.startsWith('pg-') && name.endsWith('.js'))
    const source = (await Promise.all(files.map(name => read(market, name)))).join('\n')
    const rpcNames = new Set([...source.matchAll(/\b(rpc|transaction)\(\s*'([a-z_]+)'/g)]
      .map(([, type, name]) => type === 'rpc' ? `rehub_market_${name}` : `rehub_${name}`))
    const { rows: functions } = await db.query(`SELECT proname, prosecdef, proconfig, prosrc LIKE '%current_user%' AS role_guard,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS user_role,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public'
      AND left(proname,6)='rehub_' AND prorettype <> 'trigger'::regtype AND proname <> 'rehub_pg_compat_check'`)
    assert.equal(rpcNames.size, 27)
    assert.deepEqual(sorted(functions.map(row => row.proname)), sorted(rpcNames))
    for (const fn of functions) {
      assert.deepEqual([fn.prosecdef, fn.role_guard, fn.anon, fn.user_role, fn.service], [false, true, false, false, true], fn.proname)
      assert.deepEqual(fn.proconfig, ['search_path=pg_catalog'], fn.proname)
    }

    const { rows: tables } = await db.query(`SELECT relname, relrowsecurity, EXISTS (
        SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r(role)
        WHERE has_any_column_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege(r.role, c.oid, 'DELETE,TRUNCATE,TRIGGER')) AS client_access
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND relkind='r' AND left(relname,6)='rehub_'`)
    assert.equal(tables.length, 14)
    assert.ok(tables.every(table => table.relrowsecurity && !table.client_access))
    for (const [, name] of source.matchAll(/\.from\('([a-z_]+)'\)/g)) assert.ok(tables.some(table => table.relname === name), name)
    assert.deepEqual((await db.query(`SELECT has_table_privilege('service_role','public.rehub_legacy_documents','SELECT') AS legacy,
      has_any_column_privilege('service_role','public.rehub_admins','INSERT,UPDATE') AS grant_admin,
      has_table_privilege('service_role','public.rehub_admins','DELETE') AS delete_admin`)).rows[0],
    { legacy: false, grant_admin: false, delete_admin: false })

    const expectedIndexes = [...body.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g)].map(match => match[1])
    const { rows: indexes } = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)
    assert.ok(expectedIndexes.every(name => indexes.some(index => index.indexname === name)))
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f'
      AND connamespace='public'::regnamespace AND NOT convalidated`)).rows[0].n, 0)
  } finally { await db.close() }
})

const backupDir = process.env.REHUB_TEST_BACKUP_DIR
test('109 条备份副本通过完整部署结构导入及重放，保留原 AppID 归属', { skip: !backupDir }, async () => {
  const db = await openLocalDatabase({ empty: true })
  try {
    await db.exec(`BEGIN;\n${await deploymentBody()}\nCOMMIT;`)
    await withBackupCopy(backupDir, async snapshot => {
      const sql = buildImportSql(prepareSnapshot(snapshot))
      await db.exec(sql)
      await db.exec(sql)
      const { rows } = await db.query(`SELECT count(*)::int AS documents,
        (SELECT count(DISTINCT app_id)::int FROM public.rehub_wechat_identities) AS apps,
        (SELECT bool_and(app_id = source_app_id) FROM public.rehub_wechat_identities) AS old_only
        FROM public.rehub_legacy_documents GROUP BY source_app_id`)
      assert.deepEqual(rows, [{ documents: 109, apps: 1, old_only: true }])
    })
  } catch (error) { throw new Error(safeFailure(error)) }
  finally { await db.close() }
})
