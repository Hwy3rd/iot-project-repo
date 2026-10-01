import { alertsApi, coldRoomsApi } from '@/api/endpoints'
import type { ColdRoom, ColdRoomStatus, Device, TelemetryRange } from '@/api/types'
import { ErrorState } from '@/components/common/States'
import { AlertStatusBadge, DeviceStatusBadge, ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatRelative, formatTemp } from '@/lib/format'
import { ALERT_TYPE_LABEL } from '@/lib/labels'
import { TEMP_STATE, tempState } from '@/lib/room-status'
import { cn } from '@/lib/utils'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { TemperatureChart } from './TemperatureChart'

const RANGES: { value: TelemetryRange; label: string; refreshMs: number }[] = [
  // Refresh about twice per bucket: new points appear without hammering
  // the API (the headline number above is live over the socket anyway).
  { value: '1h', label: '1 giờ', refreshMs: 30_000 },
  { value: '6h', label: '6 giờ', refreshMs: 150_000 },
  { value: '24h', label: '24 giờ', refreshMs: 450_000 },
]

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  )
}

function RoomDetail({
  room,
  status,
  devices,
  now,
}: {
  room: ColdRoom
  status: ColdRoomStatus | undefined
  devices: Device[]
  now: number
}) {
  const [range, setRange] = useState<TelemetryRange>('6h')
  const refreshMs = RANGES.find((r) => r.value === range)!.refreshMs
  const series = useQuery({
    queryKey: ['cold-rooms', room.id, 'telemetry', range],
    queryFn: () => coldRoomsApi.telemetry(room.id, range),
    refetchInterval: refreshMs,
    placeholderData: keepPreviousData,
  })
  const alerts = useQuery({
    queryKey: ['alerts', { coldRoomId: room.id, limit: 10 }],
    queryFn: () => alertsApi.list({ coldRoomId: room.id, limit: 10 }),
  })

  const latest = status?.latest ?? null
  const state = tempState(latest, now)

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Nhiệt độ"
          value={latest?.temperature != null ? formatTemp(latest.temperature) : '—'}
          tone={state === 'out' || state === 'fault' ? 'text-destructive' : undefined}
        />
        <Stat label="Ngưỡng" value={`${formatTemp(room.tempMin)} – ${formatTemp(room.tempMax)}`} />
        <Stat
          label="Cửa"
          value={latest ? (latest.doorOpen ? 'Đang mở' : 'Đóng') : '—'}
          tone={latest?.doorOpen ? 'text-warning' : undefined}
        />
        <Stat label="Cập nhật" value={latest ? formatRelative(latest.ts) : '—'} />
      </section>

      {series.data?.prediction && (
        <section
          className={cn(
            'flex flex-col gap-2 rounded-xl border p-3.5 transition-colors',
            series.data.prediction.willExceedThreshold
              ? 'border-warning/50 bg-warning/10 dark:border-warning/40 dark:bg-warning/15'
              : 'border-purple-500/20 bg-purple-50/50 dark:border-purple-500/30 dark:bg-purple-950/20'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-semibold">Dự báo AI (15 phút tới)</span>
            </div>
            {series.data.prediction.willExceedThreshold ? (
              <ToneBadge tone="warning">
                {series.data.prediction.violationType === 'OVERHEAT'
                  ? 'Nguy cơ quá nhiệt'
                  : 'Nguy cơ vượt sàn'}
              </ToneBadge>
            ) : (
              <ToneBadge tone="success">Nhiệt độ ổn định</ToneBadge>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">
              {formatTemp(series.data.prediction.predictedTemp15m)}
            </span>
            <span className="text-xs text-muted-foreground">
              (Mức độ rủi ro: {series.data.prediction.riskLevel})
            </span>
          </div>
          {series.data.prediction.recommendation && (
            <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Khuyến nghị:</span>{' '}
              {series.data.prediction.recommendation}
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Nhiệt độ theo thời gian</h3>
          <div role="group" aria-label="Khoảng thời gian" className="flex rounded-lg border bg-muted p-0.5">
            {RANGES.map((r) => (
              <Button
                key={r.value}
                size="sm"
                variant={range === r.value ? 'outline' : 'ghost'}
                aria-pressed={range === r.value}
                className={range === r.value ? 'bg-card shadow-xs' : 'text-muted-foreground'}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
        {series.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : series.isError ? (
          <ErrorState error={series.error} onRetry={() => series.refetch()} />
        ) : (
          <TemperatureChart series={series.data} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Thiết bị ({devices.length})</h3>
        {devices.length === 0 ? (
          <p className="text-muted-foreground">Phòng này chưa lắp thiết bị.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">Mã thiết bị</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Firmware</TableHead>
                  <TableHead className="pr-3">Tín hiệu cuối</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="pl-3 font-mono text-sm" translate="no">
                      {d.uniqueId}
                    </TableCell>
                    <TableCell>
                      <DeviceStatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="font-mono text-sm" translate="no">
                      {d.firmwareVersion || '—'}
                    </TableCell>
                    <TableCell className="pr-3 text-muted-foreground">
                      {d.lastHeartbeatAt ? (
                        <time dateTime={d.lastHeartbeatAt} title={formatDateTime(d.lastHeartbeatAt)}>
                          {formatRelative(d.lastHeartbeatAt)}
                        </time>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Cảnh báo gần đây</h3>
        {alerts.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : alerts.isError ? (
          <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
        ) : alerts.data.items.length === 0 ? (
          <p className="text-muted-foreground">Phòng này chưa có cảnh báo nào.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {alerts.data.items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{ALERT_TYPE_LABEL[a.type]}</p>
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
                    {a.triggerValue !== null && ` · ${formatTemp(a.triggerValue)}`}
                  </p>
                </div>
                <AlertStatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        Trạng thái hiện tại: <ToneBadge tone={TEMP_STATE[state].tone}>{TEMP_STATE[state].label}</ToneBadge>
      </p>
    </div>
  )
}

/** Right-hand panel with one room's live numbers, chart, devices and alerts. */
export function RoomDetailSheet({
  room,
  warehouseName,
  status,
  devices,
  now,
  onClose,
}: {
  room: ColdRoom | undefined
  warehouseName: string
  status: ColdRoomStatus | undefined
  devices: Device[]
  now: number
  onClose: () => void
}) {
  return (
    <Sheet open={!!room} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto pb-[env(safe-area-inset-bottom)] data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {room && (
          <>
            <SheetHeader>
              <SheetTitle className="text-xl">{room.name}</SheetTitle>
              <SheetDescription>{warehouseName}</SheetDescription>
            </SheetHeader>
            <RoomDetail key={room.id} room={room} status={status} devices={devices} now={now} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
