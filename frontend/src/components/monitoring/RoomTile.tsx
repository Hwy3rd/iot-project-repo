import type { ColdRoom, ColdRoomStatus, Device } from '@/api/types'
import { DeviceStatusBadge, ToneBadge } from '@/components/common/StatusBadge'
import { formatDateTime, formatHumidity, formatNumber, formatRelative, formatTemp } from '@/lib/format'
import { TEMP_STATE, fanState, tempState, type TempState } from '@/lib/room-status'
import { cn } from '@/lib/utils'
import { DoorClosed, DoorOpen, Droplets, Fan, Siren, TriangleAlert } from 'lucide-react'

const ACCENT: Record<TempState, string> = {
  ok: 'border-l-success',
  out: 'border-l-destructive',
  fault: 'border-l-destructive',
  stale: 'border-l-warning',
  none: 'border-l-border',
}

const TEMP_TEXT: Record<TempState, string> = {
  ok: 'text-foreground',
  out: 'text-destructive',
  fault: 'text-destructive',
  stale: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

/**
 * One room on the monitoring board: live reading, thresholds, door and
 * sensor state, each installed device with its status, and open alerts.
 * The whole tile is a button that opens the room's detail panel.
 */
export function RoomTile({
  room,
  status,
  devices,
  now,
  selected,
  onSelect,
}: {
  room: ColdRoom
  status: ColdRoomStatus | undefined
  devices: Device[]
  now: number
  selected: boolean
  onSelect: () => void
}) {
  const latest = status?.latest ?? null
  const state = tempState(latest, now)
  const fan = fanState(latest)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex h-full flex-col gap-3 rounded-xl border border-l-4 bg-card p-4 text-left shadow-xs transition-shadow',
        'hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        ACCENT[state],
        selected && 'ring-2 ring-primary/50',
      )}
    >
      <div className="flex w-full items-start gap-2">
        <h3 className="min-w-0 flex-1 font-semibold break-words">{room.name}</h3>
        <ToneBadge tone={TEMP_STATE[state].tone}>{TEMP_STATE[state].label}</ToneBadge>
      </div>

      <div className="flex w-full items-end justify-between gap-3">
        <p className={cn('text-4xl font-semibold tracking-tight tabular-nums', TEMP_TEXT[state])}>
          {latest?.temperature != null ? formatTemp(latest.temperature) : '—'}
        </p>
        <p className="text-right text-sm text-muted-foreground tabular-nums">
          Ngưỡng
          <br />
          {formatTemp(room.tempMin)} – {formatTemp(room.tempMax)}
        </p>
      </div>

      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {latest ? (
          <>
            <span className={cn('inline-flex items-center gap-1', latest.doorOpen && 'font-medium text-warning')}>
              {latest.doorOpen ? (
                <DoorOpen className="size-4" aria-hidden="true" />
              ) : (
                <DoorClosed className="size-4" aria-hidden="true" />
              )}
              {latest.doorOpen ? 'Cửa đang mở' : 'Cửa đóng'}
            </span>
            {latest.sensorFault && (
              <span className="inline-flex items-center gap-1 font-medium text-destructive">
                <TriangleAlert className="size-4" aria-hidden="true" />
                Lỗi cảm biến
              </span>
            )}
            {latest.humidity != null && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Droplets className="size-4" aria-hidden="true" />
                {formatHumidity(latest.humidity)}
              </span>
            )}
            {fan && (
              <span className={cn('inline-flex items-center gap-1', fan.fault && 'font-medium text-destructive')}>
                <Fan className="size-4" aria-hidden="true" />
                {fan.label}
              </span>
            )}
            <time dateTime={latest.ts} title={formatDateTime(latest.ts)}>
              {formatRelative(latest.ts)}
            </time>
          </>
        ) : (
          <span>Chưa nhận được số đo nào</span>
        )}
      </div>

      <div className="mt-auto flex w-full flex-col gap-1.5 border-t pt-3">
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa lắp thiết bị</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-mono" translate="no">
                  {d.uniqueId}
                </span>
                <DeviceStatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        )}
        {status && status.activeAlerts > 0 && (
          <p className="inline-flex items-center gap-1 text-sm font-medium text-destructive">
            <Siren className="size-4" aria-hidden="true" />
            {formatNumber(status.activeAlerts)} cảnh báo chưa xử lý
          </p>
        )}
      </div>
    </button>
  )
}
