import type { ColdRoom, ColdRoomStatus } from '@/api/types'
import { ToneBadge } from '@/components/common/StatusBadge'
import { StatusUnavailable } from '@/components/common/StatusUnavailable'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatNumber, formatRelative, formatTemp } from '@/lib/format'
import { DEVICE_STATUS_LABEL } from '@/lib/labels'
import { PROBLEM_DEVICE_STATUSES, TEMP_STATE, tempState, type TempState } from '@/lib/room-status'
import type { RowSelection } from '@/lib/useRowSelection'
import { cn } from '@/lib/utils'
import { Cpu, DoorClosed, DoorOpen, Siren } from 'lucide-react'
import { Link } from 'react-router'

const ACCENT: Record<TempState, string> = {
  ok: 'border-l-success',
  out: 'border-l-destructive',
  fault: 'border-l-destructive',
  stale: 'border-l-warning',
  none: 'border-l-border',
}

const TEMP_TEXT: Record<TempState, string> = {
  ok: 'text-success',
  out: 'text-destructive',
  fault: 'text-destructive',
  stale: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

function DeviceSummary({ devices }: { devices: ColdRoomStatus['devices'] }) {
  if (devices.total === 0) return <span>Chưa lắp thiết bị</span>
  const problems = PROBLEM_DEVICE_STATUSES.filter((s) => devices[s])
  return (
    <span>
      {formatNumber(devices.total)} thiết bị
      {problems.length === 0 ? (
        <span className="text-success"> · hoạt động tốt</span>
      ) : (
        problems.map((s) => (
          <span key={s} className={s === 'fault' ? 'text-destructive' : 'text-warning'}>
            {' · '}
            {formatNumber(devices[s])} {DEVICE_STATUS_LABEL[s].toLowerCase()}
          </span>
        ))
      )}
    </span>
  )
}

function ColdRoomCard({
  room,
  status,
  statusPending,
  warehouseLabel,
  selection,
}: {
  room: ColdRoom
  status: ColdRoomStatus | undefined
  statusPending: boolean
  warehouseLabel: string
  selection?: RowSelection
}) {
  const latest = status?.latest ?? null
  const state = tempState(latest)
  const selectable = selection?.isSelectable(room.id) ?? false

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-l-4 bg-card p-4 shadow-xs',
        status ? ACCENT[state] : 'border-l-border',
        selectable && selection?.isSelected(room.id) && 'ring-2 ring-primary/40',
      )}
    >
      <header className="flex items-start gap-3">
        {selectable && (
          <Checkbox
            className="mt-1"
            checked={selection!.isSelected(room.id)}
            onCheckedChange={(v) => selection!.toggle(room.id, v === true)}
            aria-label={`Chọn phòng lạnh ${room.name}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold break-words">{room.name}</h3>
          <p className="truncate text-sm text-muted-foreground">{warehouseLabel}</p>
        </div>
        {status && <ToneBadge tone={TEMP_STATE[state].tone}>{TEMP_STATE[state].label}</ToneBadge>}
      </header>

      <div className="flex items-end justify-between gap-3">
        {statusPending ? (
          <Skeleton className="h-9 w-28" />
        ) : (
          <p className={cn('text-3xl font-semibold tabular-nums', TEMP_TEXT[state])}>
            {latest?.temperature != null ? formatTemp(latest.temperature) : '—'}
          </p>
        )}
        <p className="text-right text-sm text-muted-foreground tabular-nums">
          Ngưỡng
          <br />
          {formatTemp(room.tempMin)} – {formatTemp(room.tempMax)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {latest && (
          <span className={cn('inline-flex items-center gap-1', latest.doorOpen && 'font-medium text-warning')}>
            {latest.doorOpen ? (
              <DoorOpen className="size-4" aria-hidden="true" />
            ) : (
              <DoorClosed className="size-4" aria-hidden="true" />
            )}
            {latest.doorOpen ? 'Cửa đang mở' : 'Cửa đóng'}
          </span>
        )}
        {latest && (
          <time dateTime={latest.ts} title={formatDateTime(latest.ts)}>
            Cập nhật {formatRelative(latest.ts)}
          </time>
        )}
      </div>

      {status && (
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Cpu className="size-4 shrink-0" aria-hidden="true" />
            <DeviceSummary devices={status.devices} />
          </span>
          {status.activeAlerts > 0 && (
            <Link
              to={`/alerts?coldRoomId=${room.id}`}
              className="inline-flex items-center gap-1 font-medium text-destructive hover:underline"
            >
              <Siren className="size-4" aria-hidden="true" />
              {formatNumber(status.activeAlerts)} cảnh báo
            </Link>
          )}
        </footer>
      )}
    </article>
  )
}

/**
 * Cold rooms as cards with their live state. `statuses` may be missing for a
 * room the caller can't monitor (e.g. Staff off shift): the card then shows
 * the room's configuration only.
 */
export function ColdRoomGrid({
  rooms,
  statuses,
  statusPending,
  statusError,
  warehouseLabel,
  selection,
}: {
  rooms: ColdRoom[]
  statuses: ReadonlyMap<string, ColdRoomStatus>
  statusPending: boolean
  statusError: boolean
  warehouseLabel: (warehouseId: string) => string
  selection?: RowSelection
}) {
  return (
    <>
      {statusError && <StatusUnavailable />}
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {rooms.map((room) => (
          <ColdRoomCard
            key={room.id}
            room={room}
            status={statuses.get(room.id)}
            statusPending={statusPending && !statusError}
            warehouseLabel={warehouseLabel(room.warehouseId)}
            selection={selection}
          />
        ))}
      </div>
    </>
  )
}
