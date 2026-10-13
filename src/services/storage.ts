import Taro from '@tarojs/taro'

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = Taro.getStorageSync(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

export function writeLocal<T>(key: string, value: T): void {
  Taro.setStorageSync(key, JSON.stringify(value))
}
