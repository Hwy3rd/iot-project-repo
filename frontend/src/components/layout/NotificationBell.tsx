import { notificationsApi } from '@/api/endpoints'
import { Button } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { Link } from 'react-router'

export function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.list({ unreadOnly: true, limit: 1 }),
    select: (d) => d.meta.total,
    refetchInterval: 60_000,
  })
  const count = data ?? 0
  const label = count > 0 ? `Thông báo, ${count} chưa đọc` : 'Thông báo'

  return (
    <Button variant="ghost" size="icon-lg" className="relative" asChild>
      <Link to="/notifications" aria-label={label}>
        <Bell className="size-5" aria-hidden="true" />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    </Button>
  )
}
