import { alertsApi } from '@/api/endpoints'
import type { Alert } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { EmptyState, ErrorState } from '@/components/common/States'
import { AlertStatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dayjs, formatDateTime, formatTemp } from '@/lib/format'
import { mutationErrorText } from '@/lib/forms'
import { ALERT_TYPE_LABEL } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'

const STREAM_SIZE = 30
// How long a newly arrived alert stays highlighted.
const FRESH_MS = 8_000
// Fallback when the socket is down; alerts:changed refetches it otherwise.
const REFRESH_MS = 60_000

function AlertItem({
  alert,
  roomName,
  fresh,
  onSelectRoom,
}: {
  alert: Alert
  roomName: string
  fresh: boolean
  onSelectRoom: () => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canResolve = hasRole(user?.role, ['admin', 'manager', 'technician'])

  const act = useMutation({
    mutationFn: (action: 'acknowledge' | 'resolve') =>
      action === 'acknowledge' ? alertsApi.acknowledge(alert.id) : alertsApi.resolve(alert.id),
    onSuccess: (_, action) => {
      toast.success(action === 'acknowledge' ? 'Đã tiếp nhận cảnh báo' : 'Đã xử lý cảnh báo')
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      void qc.invalidateQueries({ queryKey: ['cold-rooms', 'status'] })
    },
    onError: (error) =>
      toast.error('Không thực hiện được', {
        description: mutationErrorText(error, {
          403: 'Bạn không có quyền với cảnh báo này (nhân viên cần đang trong ca để tiếp nhận).',
          409: 'Cảnh báo vừa được người khác cập nhật.',
        }),
      }),
  })

  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 border-b px-4 py-3 transition-colors duration-1000',
        fresh && 'bg-primary/8',
        alert.status === 'resolved' && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">
          {fresh && <span className="sr-only">Mới: </span>}
          {ALERT_TYPE_LABEL[alert.type]}
        </p>
        <AlertStatusBadge status={alert.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
        <button type="button" onClick={onSelectRoom} className="font-medium text-foreground hover:underline">
          {roomName}
        </button>
        {alert.triggerValue !== null && (
          <span className="tabular-nums">
            {formatTemp(alert.triggerValue)} / ngưỡng {formatTemp(alert.threshold)}
          </span>
        )}
        <time dateTime={alert.createdAt} title={formatDateTime(alert.createdAt)}>
          {dayjs(alert.createdAt).fromNow()}
        </time>
      </div>
      {alert.status !== 'resolved' && (
        <div className="flex gap-2 pt-1">
          {alert.status === 'open' && (
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate('acknowledge')}>
              Tiếp nhận
            </Button>
          )}
          {canResolve && (
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate('resolve')}>
              Xử lý xong
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Newest alerts of one warehouse, newest first. The socket's alerts:changed
 * invalidates ['alerts'] (useWarehouseLive), so a new alert shows up within
 * a moment and is highlighted briefly; the list also polls as a fallback.
 */
export function AlertStream({
  warehouseId,
  roomName,
  onSelectRoom,
}: {
  warehouseId: string
  roomName: (coldRoomId: string) => string
  onSelectRoom: (coldRoomId: string) => void
}) {
  const query = useQuery({
    queryKey: ['alerts', { warehouseId, limit: STREAM_SIZE }],
    queryFn: () => alertsApi.list({ warehouseId, limit: STREAM_SIZE }),
    refetchInterval: REFRESH_MS,
  })
  const alerts = query.data?.items ?? []
  const ids = alerts.map((a) => a.id).join()

  // Ids already on screen. The first load counts as seen (nothing flashes on
  // open); anything that arrives later is "fresh" until the timer below
  // folds it in. Reset when the warehouse changes.
  const [known, setKnown] = useState<{ warehouseId: string; ids: Set<string> } | null>(null)
  if (query.data && known?.warehouseId !== warehouseId) {
    setKnown({ warehouseId, ids: new Set(alerts.map((a) => a.id)) })
  }
  const fresh = new Set(known ? alerts.filter((a) => !known.ids.has(a.id)).map((a) => a.id) : [])

  useEffect(() => {
    if (!ids) return
    const t = setTimeout(
      () => setKnown((k) => (k ? { ...k, ids: new Set([...k.ids, ...ids.split(',')]) } : k)),
      FRESH_MS,
    )
    return () => clearTimeout(t)
  }, [ids])

  const openCount = alerts.filter((a) => a.status !== 'resolved').length

  return (
    <section aria-label="Luồng cảnh báo" className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-semibold">Cảnh báo</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{openCount} chưa xử lý</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-relevant="additions">
        {query.isPending ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : alerts.length === 0 ? (
          <EmptyState title="Chưa có cảnh báo" description="Kho này chưa phát sinh cảnh báo nào." />
        ) : (
          <ul>
            {alerts.map((a) => (
              <AlertItem
                key={a.id}
                alert={a}
                roomName={roomName(a.coldRoomId)}
                fresh={fresh.has(a.id)}
                onSelectRoom={() => onSelectRoom(a.coldRoomId)}
              />
            ))}
          </ul>
        )}
      </div>
      <footer className="border-t px-4 py-2.5 text-sm">
        <Link to={`/alerts?warehouseId=${warehouseId}`} className="text-primary hover:underline">
          Xem tất cả cảnh báo của kho
        </Link>
      </footer>
    </section>
  )
}
