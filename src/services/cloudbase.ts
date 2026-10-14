import Taro from '@tarojs/taro'

interface CloudResult<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
interface CloudApi {
  init(options: { env: string; traceUser: boolean }): void
  callFunction(options: { name: string; data: object }): Promise<{ result: CloudResult<unknown> }>
  uploadFile(options: { cloudPath: string; filePath: string }): Promise<{ fileID: string }>
}
declare const wx: { cloud?: CloudApi } | undefined

let initialized = false

export function getCloud(): CloudApi {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP || typeof wx === 'undefined' || !wx.cloud) {
    throw new Error('当前环境不支持微信云开发，请使用小程序或演示模式')
  }
  if (!__CLOUDBASE_ENV_ID__) throw new Error('尚未配置云开发环境 ID')
  if (!initialized) {
    wx.cloud.init({ env: __CLOUDBASE_ENV_ID__, traceUser: true })
    initialized = true
  }
  return wx.cloud
}

export async function cloudCall<T>(action: string, params: object = {}): Promise<T> {
  const cloud = getCloud()
  let response: { result: CloudResult<unknown> }
  try { response = await cloud.callFunction({ name: 'market', data: { action, ...params } }) }
  catch { throw new Error('云服务暂时不可用，请检查环境和 market 云函数') }
  const result = response.result as CloudResult<T>
  if (!result?.ok) throw new Error(result?.error?.message || '云服务暂时不可用')
  return result.data as T
}
