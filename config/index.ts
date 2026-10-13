import { defineConfig } from '@tarojs/cli'

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
    __API_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE_URL || '')
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
