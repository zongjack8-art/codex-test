import Taro from '@tarojs/taro'

export type DataMode = 'cloud' | 'api' | 'mock'

export function getDataMode(): DataMode {
  if (__CLOUDBASE_ENV_ID__ && Taro.getEnv() === Taro.ENV_TYPE.WEAPP) return 'cloud'
  if (__API_BASE_URL__) return 'api'
  return 'mock'
}

export function isH5CloudFallback(): boolean {
  return Boolean(__CLOUDBASE_ENV_ID__) && Taro.getEnv() !== Taro.ENV_TYPE.WEAPP && !__API_BASE_URL__
}
