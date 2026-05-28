import { cn } from '@/lib/utils'

interface Props {
  size?: number
  className?: string
}

export function Spinner({ size = 14, className }: Props) {
  return (
    <span
      aria-label="loading"
      role="status"
      style={{ width: size, height: size, borderWidth: Math.max(1, size / 8) }}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-r-transparent align-[-2px]',
        className,
      )}
    />
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-text-secondary">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}
