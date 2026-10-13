import Taro from '@tarojs/taro'
import { demoUser } from '../data/mock'
import type { Session } from '../types/market'
import { readLocal, writeLocal } from './storage'

const SESSION_KEY = 'campusmarket.session.v1'

export function getSession(): Session | null {
  return readLocal<Session | null>(SESSION_KEY, null)
}

export function signOut(): void {
  Taro.removeStorageSync(SESSION_KEY)
}

export async function loginWithWechat(): Promise<Session> {
  if (!__API_BASE_URL__) {
    const session = { token: 'demo-only', user: demoUser }
    writeLocal(SESSION_KEY, session)
    return session
  }

  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) {
    throw new Error('H5 登录需接入服务端网页授权')
  }

  const result = await Taro.login()
  if (!result.code) throw new Error('微信登录未返回授权码')
  const response = await Taro.request<{ data: Session }>({
    url: `${__API_BASE_URL__}/auth/wechat/login`,
    method: 'POST',
    data: { code: result.code }
  })
  if (response.statusCode !== 200 || !response.data?.data?.token) throw new Error('登录失败，请稍后重试')
  writeLocal(SESSION_KEY, response.data.data)
  return response.data.data
}
