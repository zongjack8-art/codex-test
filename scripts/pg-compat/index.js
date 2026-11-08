let database

function getDatabase() {
  if (!database) {
    const cloudbase = require('@cloudbase/js-sdk')
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV, timeout: 3000 })
    database = app.rdb()
  }
  return database
}

async function probePostgres(openDatabase = getDatabase) {
  try {
    const { data, error } = await openDatabase().rpc('rehub_pg_compat_check', {}, { get: true })
    if (error?.code === 'PGRST202') return { status: 'failed', code: 'PG_RPC_NOT_READY' }
    if (error?.code === '42501') return { status: 'failed', code: 'PG_RPC_FORBIDDEN' }
    if (error) return { status: 'failed', code: 'PG_RPC_FAILED' }
    return data === 1
      ? { status: 'passed' }
      : { status: 'failed', code: 'PG_UNEXPECTED_RESULT' }
  } catch {
    return { status: 'failed', code: 'PG_RPC_FAILED' }
  }
}

async function probeStorage(cloud, fileID) {
  if (!fileID) return { status: 'skipped', code: 'STORAGE_FILE_NOT_CONFIGURED' }
  if (!fileID.startsWith('cloud://')) return { status: 'failed', code: 'STORAGE_FILE_ID_INVALID' }
  try {
    const { fileContent } = await cloud.downloadFile({ fileID })
    if (Buffer.isBuffer(fileContent) && fileContent.length > 0) return { status: 'passed' }
  } catch { /* Keep raw SDK errors and object identifiers out of the response. */ }
  return { status: 'failed', code: 'STORAGE_READ_FAILED' }
}

async function probeCloud(env, loadCloud = () => require('wx-server-sdk'), checkDatabase = probePostgres,
  readIdentity = cloud => cloud.getWXContext()) {
  const skipped = { status: 'skipped' }
  const blocked = code => ({ ok: false, identity: { status: 'failed', code }, postgres: skipped, storage: skipped })
  const expectedAppId = env.REHUB_PG_PROBE_APP_ID
  if (!expectedAppId) return blocked('WX_APP_ID_NOT_CONFIGURED')

  let cloud, context
  try {
    cloud = loadCloud()
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    context = readIdentity(cloud)
  } catch { return blocked('WX_CONTEXT_UNAVAILABLE') }

  if (context?.APPID !== expectedAppId || (context.FROM_APPID && context.FROM_APPID !== expectedAppId)) {
    return blocked('WX_APP_ID_MISMATCH')
  }
  if (typeof context.OPENID !== 'string' || !context.OPENID.trim()) return blocked('WX_OPENID_MISSING')
  if (context.FROM_OPENID && context.FROM_OPENID !== context.OPENID) return blocked('WX_OPENID_MISMATCH')

  const [postgres, storage] = await Promise.all([
    checkDatabase(),
    probeStorage(cloud, env.REHUB_PG_PROBE_FILE_ID)
  ])
  return {
    ok: postgres.status === 'passed' && storage.status !== 'failed',
    identity: { status: 'passed' },
    postgres,
    storage
  }
}

exports.probePostgres = probePostgres
exports.probeCloud = probeCloud
exports.main = (_event, invocation) => probeCloud(process.env, undefined, undefined, () => {
  const { environment, environ } = require('@cloudbase/js-sdk').parseContext(invocation)
  const wx = environment || environ
  return { APPID: wx?.WX_APPID, OPENID: wx?.WX_OPENID,
    FROM_APPID: wx?.WX_FROM_APPID ?? wx?.FROM_APPID, FROM_OPENID: wx?.WX_FROM_OPENID ?? wx?.FROM_OPENID }
})
