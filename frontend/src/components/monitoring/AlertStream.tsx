import { alertsApi } from '@/api/endpoints'
import type { Alert } from '@/api/types'
import { EmptyState, ErrorState } from '@/components/common/States'
import { AlertStatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dayjs, formatDateTime, formatTemp } from '@/lib/format'
import { ALERT_TYPE_LABEL } from '@/lib/labels'
import { useAlertActions } from '@/lib/useAlertActions'
import { cn } from '@/lib/utils'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

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
  const actions = useAlertActions()
  const busy = actions.pendingId === alert.id

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
          {actions.canAcknowledge(alert) && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.run(alert, 'acknowledge')}>
              Tiếp nhận
            </Button>
          )}
          {actions.canResolve(alert) && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.run(alert, 'resolve')}>
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
  focusRoomId,
}: {
  warehouseId: string
  roomName: (coldRoomId: string) => string
  onSelectRoom: (coldRoomId: string) => void
  /** The room open on the page: the stream can narrow to it (the default). */
  focusRoomId?: string | null
}) {
  const [wholeWarehouse, setWholeWarehouse] = useState(false)
  const coldRoomId = focusRoomId && !wholeWarehouse ? focusRoomId : undefined
  const query = useQuery({
    queryKey: ['alerts', { warehouseId, coldRoomId, limit: STREAM_SIZE }],
    queryFn: () => alertsApi.list({ warehouseId, coldRoomId, limit: STREAM_SIZE }),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  })
  // What "already seen" is tracked against: switching room/scope shows a
  // different list, which must not flash as newly arrived.
  const scope = `${warehouseId}:${coldRoomId ?? '*'}`
  const alerts = query.data?.items ?? []
  const ids = alerts.map((a) => a.id).join()

  // Ids already on screen. The first load counts as seen (nothing flashes on
  // open); anything that arrives later is "fresh" until the timer below
  // folds it in. Reset when the warehouse changes.
  const [known, setKnown] = useState<{ scope: string; ids: Set<string> } | null>(null)
  // Not from placeholder data: that's still the previous scope's list.
  if (query.data && !query.isPlaceholderData && known?.scope !== scope) {
    setKnown({ scope, ids: new Set(alerts.map((a) => a.id)) })
  }
  const fresh = new Set(known && known.scope === scope ? alerts.filter((a) => !known.ids.has(a.id)).map((a) => a.id) : [])

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
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Cảnh báo</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{openCount} chưa xử lý</span>
        </div>
        {focusRoomId && (
          <div role="group" aria-label="Phạm vi cảnh báo" className="flex rounded-lg border bg-muted p-0.5">
            {[
              { whole: false, label: 'Phòng này' },
              { whole: true, label: 'Toàn kho' },
            ].map((o) => (
              <Button
                key={o.label}
                size="sm"
                variant={wholeWarehouse === o.whole ? 'outline' : 'ghost'}
                aria-pressed={wholeWarehouse === o.whole}
                className={cn('flex-1', wholeWarehouse === o.whole ? 'bg-card shadow-xs' : 'text-muted-foreground')}
                onClick={() => setWholeWarehouse(o.whole)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        )}
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
          <EmptyState
            title="Chưa có cảnh báo"
            description={coldRoomId ? 'Phòng này chưa phát sinh cảnh báo nào.' : 'Kho này chưa phát sinh cảnh báo nào.'}
          />
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
