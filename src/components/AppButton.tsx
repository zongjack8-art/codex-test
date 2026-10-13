import { Button } from '@tarojs/components'
import type { ReactNode } from 'react'

export default function AppButton({ children, onClick, variant = 'primary', block = false, loading = false, disabled = false, className = '' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; block?: boolean; loading?: boolean; disabled?: boolean; className?: string }) {
  return <Button className={`ui-button ui-button--${variant} ${block ? 'ui-button--block' : ''} ${disabled || loading ? 'is-disabled' : ''} ${className}`} onClick={onClick} disabled={disabled || loading} loading={loading}>{children}</Button>
}
