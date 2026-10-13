import Taro from '@tarojs/taro'
import { getSession } from './auth'

export async function uploadImage(filePath: string): Promise<string> {
  if (!__API_BASE_URL__) return filePath
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
