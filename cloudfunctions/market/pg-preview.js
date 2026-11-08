// This handler has no document-database path, even if the deploy settings are incomplete.
exports.main = process.env.REHUB_MARKET_BACKEND === 'postgresql'
  ? require('./pg-market').createRuntime()
  : async () => ({ ok: false, error: { code: 'SERVER_ERROR', message: 'PostgreSQL 联调后台未启用' } })
