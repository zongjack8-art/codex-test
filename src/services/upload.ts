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
  if (mode === 'mock') {
    if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP || !filePath || /^wxfile:\/\/usr\//.test(filePath) || /^(cloud|https?):\/\//.test(filePath)) return filePath
    const info = await Taro.getFileInfo({ filePath })
    if (!('size' in info)) throw new Error('无法读取图片')
    if (info.size > 3 * 1024 * 1024) throw new Error('演示模式单张图片不能超过 3 MB')
    const saved = await Taro.saveFile({ tempFilePath: filePath })
    if (!('savedFilePath' in saved)) throw new Error('保存图片失败，请检查本机存储空间')
    return saved.savedFilePath
  }
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

export async function removeMockImage(filePath: string): Promise<void> {
  if (getDataMode() !== 'mock' || Taro.getEnv() !== Taro.ENV_TYPE.WEAPP || !/^wxfile:\/\/usr\//.test(filePath)) return
  try { await Taro.removeSavedFile({ filePath }) } catch { /* File may already be gone. */ }
}

export async function discardUploadedImages(fileIDs: string[], purpose: 'product' | 'avatar' = 'product'): Promise<void> {
  if (!fileIDs.length) return
  if (getDataMode() === 'cloud') {
    const cloudFiles = fileIDs.filter(value => value.startsWith('cloud://'))
    if (cloudFiles.length) await cloudCall('discardImages', { fileIDs: cloudFiles, purpose })
    return
  }
  await Promise.all(fileIDs.map(removeMockImage))
}
