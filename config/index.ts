import { defineConfig } from '@tarojs/cli'
import campus from '../cloudfunctions/market/campus.json'

// WeChat is the primary runtime for CampusMarket. Default to CloudBase so a
// development restart cannot silently fall back to per-device mock data when
// TARO_APP_DATA_SOURCE is omitted. H5 still falls back to mock at runtime via
// getDataMode(), because cloud mode is only enabled inside WEAPP.
const dataSource = process.env.TARO_APP_DATA_SOURCE || 'cloud'
const pgPreview = process.env.TARO_BUILD_TARGET === 'weapp-pg-preview'
const explicitCloudEnv = process.env.TARO_APP_CLOUDBASE_ENV_ID
if (!['mock', 'cloud', 'api'].includes(dataSource)) throw new Error('TARO_APP_DATA_SOURCE 只能为 mock、cloud 或 api')
if (dataSource === 'api' && !process.env.TARO_APP_API_BASE_URL) throw new Error('api 模式需要 TARO_APP_API_BASE_URL')
if (pgPreview && (dataSource !== 'cloud' || !explicitCloudEnv || !/^[a-z0-9-]+$/.test(explicitCloudEnv) || explicitCloudEnv === campus.cloudEnvId)) {
  throw new Error('PostgreSQL 联调构建需要显式设置非旧环境的 TARO_APP_CLOUDBASE_ENV_ID')
}

export default defineConfig({
  projectName: 'campusmarket',
  date: '2026-10-13',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: pgPreview ? 'dist/weapp-pg-preview' : process.env.TARO_BUILD_TARGET === 'h5' ? 'dist/h5' : 'dist/weapp',
  framework: 'react',
  compiler: 'webpack5',
  plugins: [],
  defineConstants: {
    __DATA_SOURCE__: JSON.stringify(dataSource),
    __API_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE_URL || ''),
    __CLOUDBASE_ENV_ID__: JSON.stringify(explicitCloudEnv || campus.cloudEnvId),
    __CLOUDBASE_FUNCTION_NAME__: JSON.stringify(pgPreview ? 'rehub_market_pg_preview' : 'market')
  },
  copy: { patterns: [], options: {} },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      url: { enable: true, config: { limit: 1024 } },
      cssModules: { enable: false }
    }
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: { mode: 'hash' },
    postcss: {
      autoprefixer: { enable: true },
      cssModules: { enable: false }
    }
  }
})
