import Taro from '@tarojs/taro'
import { ensureUserSession, getSession } from './auth'
import { cloudCall, getCloud } from './cloudbase'
import { getDataMode } from './mode'

export async function uploadImage(filePath: string, purpose: 'product' | 'avatar' = 'product'): Promise<string> {
  const mode = getDataMode()
  if (mode === 'cloud') {
    if (filePath.startsWith('cloud://')) return filePath
    const user = (await ensureUserSession()).user
    const info = await Taro.getFileInfo({ filePath })
    if (!('size' in info) || info.size > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5 MB')
    const cloudPath = `incoming/${user.id}/${Date.now()}${Math.random().toString(36).slice(2, 12)}.jpg`
    const uploaded = await getCloud().uploadFile({ cloudPath, filePath })
    const result = await cloudCall<{ fileID: string }>('finalizeImage', { fileID: uploaded.fileID, purpose })
    return result.fileID
  }
  if (mode === 'mock') return filePath
  if (/^https:\/\//.test(filePath)) return filePath
  const token = getSession()?.token
  const response = await Taro.uploadFile({
    url: `${__API_BASE_URL__}/uploads/images`,
    filePath,
    name: 'file',
    header: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('图片上传失败')
  const payload = JSON.parse(response.data) as { data: { url: string } }
  if (!payload.data?.url) throw new Error('图片上传未返回地址')
  return payload.data.url
}
