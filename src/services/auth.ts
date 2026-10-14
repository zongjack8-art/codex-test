import Taro from '@tarojs/taro'
import { campusConfig, normalizeLegacyLocation } from '../config/campus'
import { demoUser } from '../data/mock'
import type { ProfileInput, Session, UserProfile } from '../types/market'
import { apiRequest } from './api'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { readLocal, writeLocal } from './storage'

const SESSION_KEY = 'campusmarket.session.v2'
let cloudSessionConfirmed = false

export function getSession(): Session | null {
  const session = readLocal<Session | null>(SESSION_KEY, null)
  const mode = getDataMode()
  if (!session) return null
  if (mode === 'mock') {
    if (session.user.id !== demoUser.id) return null
    return { ...session, user: { ...session.user, school: campusConfig.schoolName, campus: normalizeLegacyLocation(session.user.campus) } }
  }
  if (mode === 'cloud' && !cloudSessionConfirmed) return null
  return session
}

export function signOut(): void {
  Taro.removeStorageSync(SESSION_KEY)
  cloudSessionConfirmed = false
}

export async function loginWithWechat(): Promise<Session> {
  const mode = getDataMode()
  if (mode === 'mock') {
    const session = { token: 'demo-only', user: getSession()?.user || demoUser }
    writeLocal(SESSION_KEY, session)
    return session
  }
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) throw new Error('H5 登录需另行接入网页授权')
  const login = await Taro.login()
  if (!login.code) throw new Error('微信登录未返回授权码')

  // CloudBase gets OPENID from the trusted function context, never from a client userId.
  const session = mode === 'cloud'
    ? { user: await cloudCall<UserProfile>('login') }
    : (await Taro.request<{ data: Session }>({ url: `${__API_BASE_URL__}/auth/wechat/login`, method: 'POST', data: { code: login.code } })).data.data
  if (!session?.user?.id) throw new Error('登录失败，请稍后重试')
  if (mode === 'cloud') cloudSessionConfirmed = true
  writeLocal(SESSION_KEY, session)
  return session
}

export async function ensureUserSession(): Promise<Session> {
  const cached = getSession()
  if (getDataMode() === 'cloud' && cloudSessionConfirmed && cached?.user?.id) return cached
  return loginWithWechat()
}

export async function getCurrentUser(): Promise<UserProfile> {
  if (getDataMode() === 'cloud') return (await loginWithWechat()).user
  if (getDataMode() === 'api') return apiRequest<UserProfile>('/me')
  return getSession()?.user || demoUser
}

export async function updateProfile(input: ProfileInput): Promise<UserProfile> {
  const mode = getDataMode()
  let user: UserProfile
  if (mode === 'cloud') user = await cloudCall<UserProfile>('updateProfile', { profile: input })
  else if (mode === 'api') user = await apiRequest<UserProfile>('/me', 'PATCH', input)
  else user = { ...demoUser, ...input, school: campusConfig.schoolName, campus: normalizeLegacyLocation(input.campus) }
  writeLocal(SESSION_KEY, { ...getSession(), ...(mode === 'mock' ? { token: 'demo-only' } : {}), user })
  return user
}
