import Taro from '@tarojs/taro'

export type DataMode = 'cloud' | 'api' | 'mock'

export function getDataMode(): DataMode {
  if (__DATA_SOURCE__ === 'cloud' && Taro.getEnv() === Taro.ENV_TYPE.WEAPP) return 'cloud'
  if (__DATA_SOURCE__ === 'api' && __API_BASE_URL__) return 'api'
  return 'mock'
}

export function isH5CloudFallback(): boolean {
  return __DATA_SOURCE__ === 'cloud' && Taro.getEnv() !== Taro.ENV_TYPE.WEAPP
}
