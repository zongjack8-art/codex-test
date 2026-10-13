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
