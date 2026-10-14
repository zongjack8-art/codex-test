export function formatProductTime(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '最近发布'
  const days = Math.floor(Math.max(0, now - timestamp) / 86400000)
  if (days === 0) return '今天发布'
  if (days === 1) return '昨天发布'
  if (days < 7) return `${days} 天前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** Compact detail-page time, using the viewer's local calendar for "昨天". */
export function formatDetailTime(value: string | number, now = Date.now()): string {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '发布时间待补充'
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}小时前`
  const today = new Date(now).setHours(0, 0, 0, 0)
  if (timestamp >= today - 86_400_000 && timestamp < today) return '昨天'
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}天前`
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
