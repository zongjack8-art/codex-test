const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const { probeCloud, probePostgres } = require('./index')

const cloudEnv = { REHUB_PG_PROBE_APP_ID: 'test-app' }
const unexpected = () => assert.fail('unexpected call')

test('PostgreSQL 探针发起固定的只读 RPC', async () => {
  const result = await probePostgres(() => ({
    async rpc(name, params, options) {
      assert.equal(name, 'rehub_pg_compat_check')
      assert.deepEqual(params, {})
      assert.deepEqual(options, { get: true })
      return { data: 1, error: null }
    }
  }))
  assert.deepEqual(result, { status: 'passed' })
})

test('RPC 缺失、权限不足和其他错误只返回固定诊断码', async () => {
  for (const [code, expected] of [
    ['PGRST202', 'PG_RPC_NOT_READY'],
    ['42501', 'PG_RPC_FORBIDDEN'],
    ['OTHER', 'PG_RPC_FAILED']
  ]) {
    const result = await probePostgres(() => ({
      rpc: async () => ({ error: { code, message: 'private gateway details' } })
    }))
    assert.deepEqual(result, { status: 'failed', code: expected })
  }
  const result = await probePostgres(() => { throw new Error('private SDK details') })
  assert.deepEqual(result, { status: 'failed', code: 'PG_RPC_FAILED' })
})

test('RPC 查询结果不符合预期时报告失败', async () => {
  const result = await probePostgres(() => ({
    rpc: async () => ({ data: null, error: null })
  }))
  assert.deepEqual(result, { status: 'failed', code: 'PG_UNEXPECTED_RESULT' })
})

test('已安装的 CommonJS SDK 提供事件函数使用的 API', () => {
  // SDK 初始化后持有 BroadcastChannel，用子进程隔离它的生命周期。
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict')
    const wxSdk = require('wx-server-sdk')
    const cloudbase = require('@cloudbase/js-sdk')
    assert.equal(typeof wxSdk.init, 'function')
    assert.equal(typeof wxSdk.getWXContext, 'function')
    assert.equal(typeof cloudbase.SYMBOL_CURRENT_ENV, 'symbol')
    const app = cloudbase.init({ env: 'local-sdk-smoke-test', timeout: 3000 })
    assert.equal(typeof app.rdb().rpc, 'function')
    process.exit(0)
  `], { cwd: __dirname, timeout: 15000 })
})

test('云函数只信任微信上下文，AppID 不匹配或缺少 OPENID 时跳过后端检查', async () => {
  for (const [context, code] of [
    [{ APPID: 'other-app', OPENID: 'example-openid' }, 'WX_APP_ID_MISMATCH'],
    [{ APPID: 'test-app', OPENID: '' }, 'WX_OPENID_MISSING']
  ]) {
    const result = await probeCloud(cloudEnv, () => ({ init() {}, getWXContext: () => context, downloadFile: unexpected }), unexpected)
    assert.deepEqual(result, {
      ok: false,
      identity: { status: 'failed', code },
      postgres: { status: 'skipped' },
      storage: { status: 'skipped' }
    })
  }
})

test('云函数分别报告身份、数据库和已配置的存储读取结果', async () => {
  const fileID = 'cloud://example/bucket/test.txt'
  const result = await probeCloud({ ...cloudEnv, REHUB_PG_PROBE_FILE_ID: fileID }, () => ({
    DYNAMIC_CURRENT_ENV: 'dynamic-env',
    init(options) { assert.deepEqual(options, { env: 'dynamic-env' }) },
    getWXContext: () => ({ APPID: 'test-app', OPENID: 'example-openid' }),
    async downloadFile(options) {
      assert.deepEqual(options, { fileID })
      return { fileContent: Buffer.from('fixture') }
    }
  }), async () => ({ status: 'passed' }))
  assert.deepEqual(result, {
    ok: true, identity: { status: 'passed' }, postgres: { status: 'passed' }, storage: { status: 'passed' }
  })
})

test('未指定对象时存储检查显示为跳过，数据库失败仍独立报告', async () => {
  const result = await probeCloud(cloudEnv, () => ({
    init() {},
    getWXContext: () => ({ APPID: 'test-app', OPENID: 'example-openid' }),
    downloadFile: unexpected
  }), async () => ({ status: 'failed', code: 'PG_RPC_NOT_READY' }))
  assert.deepEqual(result, {
    ok: false,
    identity: { status: 'passed' },
    postgres: { status: 'failed', code: 'PG_RPC_NOT_READY' },
    storage: { status: 'skipped', code: 'STORAGE_FILE_NOT_CONFIGURED' }
  })
})

test('存储读取失败时返回固定错误码', async () => {
  const result = await probeCloud({ ...cloudEnv, REHUB_PG_PROBE_FILE_ID: 'cloud://example/bucket/test.txt' }, () => ({
    init() {},
    getWXContext: () => ({ APPID: 'test-app', OPENID: 'example-openid' }),
    async downloadFile() { throw new Error('private storage details') }
  }), async () => ({ status: 'passed' }))
  assert.equal(result.ok, false)
  assert.deepEqual(result.storage, { status: 'failed', code: 'STORAGE_READ_FAILED' })
})
