import Taro from '@tarojs/taro'
import { getSession } from './auth'

interface Envelope<T> { data: T; message?: string }

export async function apiRequest<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', data?: object): Promise<T> {
  const token = getSession()?.token
  const response = await Taro.request<Envelope<T>>({
    url: `${__API_BASE_URL__}${path}`,
    method,
    data,
    header: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.data?.message || `请求失败（${response.statusCode}）`)
  }
  return response.data.data
}
