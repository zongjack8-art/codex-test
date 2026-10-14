import { defineConfig } from '@tarojs/cli'
import campus from '../cloudfunctions/market/campus.json'

const dataSource = process.env.TARO_APP_DATA_SOURCE || 'mock'
if (!['mock', 'cloud', 'api'].includes(dataSource)) throw new Error('TARO_APP_DATA_SOURCE 只能为 mock、cloud 或 api')
if (dataSource === 'api' && !process.env.TARO_APP_API_BASE_URL) throw new Error('api 模式需要 TARO_APP_API_BASE_URL')

export default defineConfig({
  projectName: 'campusmarket',
  date: '2026-10-13',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: process.env.TARO_BUILD_TARGET === 'h5' ? 'dist/h5' : 'dist/weapp',
  framework: 'react',
  compiler: 'webpack5',
  plugins: [],
  defineConstants: {
    __DATA_SOURCE__: JSON.stringify(dataSource),
    __API_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE_URL || ''),
    __CLOUDBASE_ENV_ID__: JSON.stringify(process.env.TARO_APP_CLOUDBASE_ENV_ID || campus.cloudEnvId)
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
