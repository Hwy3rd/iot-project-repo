import { notificationsApi } from '@/api/endpoints'
import type { AppNotification } from '@/api/types'
import { Spinner } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDateTime, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

// How many of the latest notifications the header panel lists.
const RECENT = 8

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.list({ unreadOnly: true, limit: 1 }),
    select: (d) => d.meta.total,
    refetchInterval: 60_000,
  })
  // Fetched when the panel opens; the 'notifications' prefix means a push
  // (usePushBridge) or a read on the notifications page refreshes it too.
  const recent = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => notificationsApi.list({ limit: RECENT }),
    enabled: open,
  })
  const count = data ?? 0
  const label = count > 0 ? `Thông báo, ${count} chưa đọc` : 'Thông báo'

  // The notifications page marks it read and shows the full detail.
  const openOne = (n: AppNotification) => {
    setOpen(false)
    navigate(`/notifications?open=${encodeURIComponent(n.id)}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="relative" aria-label={label}>
          <Bell className="size-5" aria-hidden="true" />
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
          <h2 className="font-semibold">Thông báo</h2>
          <span className="text-xs text-muted-foreground">
            {count > 0 ? `${count} chưa đọc` : 'Đã đọc hết'}
          </span>
        </div>

        <div className="max-h-[min(26rem,60dvh)] overflow-y-auto">
          {recent.isPending ? (
            <div className="py-8">
              <Spinner />
            </div>
          ) : recent.isError ? (
            <p className="px-4 py-8 text-center text-muted-foreground">Không tải được thông báo.</p>
          ) : recent.data.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted-foreground">Chưa có thông báo nào.</p>
          ) : (
            <ul className="divide-y">
              {recent.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openOne(n)}
                    className="flex w-full gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span
                      aria-hidden="true"
                      className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block break-words', n.readAt ? 'font-normal' : 'font-semibold')}>
                        {n.title}
                        {!n.readAt && <span className="sr-only"> (chưa đọc)</span>}
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-muted-foreground">{n.body}</span>
                      <time
                        dateTime={n.createdAt}
                        title={formatDateTime(n.createdAt)}
                        className="mt-1 block text-xs text-muted-foreground"
                      >
                        {formatRelative(n.createdAt)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t p-2">
          <Button variant="ghost" className="w-full" asChild>
            <Link to="/notifications" onClick={() => setOpen(false)}>
              Xem tất cả thông báo
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
