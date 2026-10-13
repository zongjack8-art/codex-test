import { Text } from '@tarojs/components'
import type { ReactNode } from 'react'
import type { ProductStatus } from '../types/market'

export type BadgeTone = 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

export function Badge({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <Text className={`badge badge--${tone} ${className}`}>{children}</Text>
}

export function StatusBadge({ status }: { status: ProductStatus }) {
  const labels = { selling: '在售', sold: '已售', offline: '已下架' }
  const tones: Record<ProductStatus, BadgeTone> = { selling: 'success', sold: 'neutral', offline: 'warning' }
  return <Badge tone={tones[status]}>{labels[status]}</Badge>
}
