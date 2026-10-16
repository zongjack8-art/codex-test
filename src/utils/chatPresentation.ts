import type { ChatMessage } from '../types/market'

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  current.forEach(message => byId.set(message.id, message))
  incoming.forEach(message => byId.set(message.id, message))
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function newIncomingMessages(current: ChatMessage[], incoming: ChatMessage[], myId: string, visible: boolean, conversationId: string): ChatMessage[] {
  if (!visible || !myId || !conversationId) return []
  const known = new Set(current.map(message => message.id))
  return incoming.filter(message => message.conversationId === conversationId && message.senderId !== myId && !known.has(message.id))
}

export function sendContent(input: string, retryContent?: string | null): string {
  return (retryContent ?? input).trim()
}

function dayKey(value: number): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function yesterday(now: Date): Date {
  const date = new Date(now)
  date.setDate(date.getDate() - 1)
  return date
}

export function formatMessageDay(value: number, now = Date.now()): string {
  const date = new Date(value)
  const today = new Date(now)
  if (dayKey(value) === dayKey(now)) return '今天'
  if (dayKey(value) === dayKey(yesterday(today).getTime())) return '昨天'
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatMessageTime(value: number): string {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatConversationTime(value: number, now = Date.now()): string {
  const date = new Date(value)
  const today = new Date(now)
  if (dayKey(value) === dayKey(now)) return formatMessageTime(value)
  if (dayKey(value) === dayKey(yesterday(today).getTime())) return '昨天'
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function groupMessagesByDay(messages: ChatMessage[], now = Date.now()): Array<{ key: string; label: string; messages: ChatMessage[] }> {
  const groups: Array<{ key: string; label: string; messages: ChatMessage[] }> = []
  mergeMessages([], messages).forEach(message => {
    const key = dayKey(message.createdAt)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.messages.push(message)
    else groups.push({ key, label: formatMessageDay(message.createdAt, now), messages: [message] })
  })
  return groups
}

export function canOpenConversationProduct(status: string): boolean {
  return status !== 'offline' && status !== 'deleted'
}
