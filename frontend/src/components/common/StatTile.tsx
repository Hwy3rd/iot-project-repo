import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

/** Icon + label + count. Links somewhere when `to` is given; `value` undefined = loading. */
export function StatTile({
  label,
  value,
  icon: Icon,
  to,
  tone = 'text-primary bg-primary/10',
}: {
  label: string
  value: number | undefined
  icon: LucideIcon
  to?: string
  tone?: string
}) {
  const body: ReactNode = (
    <>
      <span className={cn('hidden size-10 shrink-0 place-items-center rounded-lg sm:grid', tone)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block leading-snug text-muted-foreground sm:truncate">{label}</span>
        {value === undefined ? (
          <Skeleton className="mt-1 h-7 w-12" />
        ) : (
          <span className="block text-2xl font-semibold tabular-nums">{formatNumber(value)}</span>
        )}
      </span>
    </>
  )
  const base = 'flex items-center gap-3 rounded-xl border bg-card p-3 sm:p-4'

  if (!to) return <div className={base}>{body}</div>
  return (
    <Link
      to={to}
      className={cn(
        base,
        'transition-[border-color] duration-150 hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
      )}
    >
      {body}
    </Link>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{children}</div>
}
