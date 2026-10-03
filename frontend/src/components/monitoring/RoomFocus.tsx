import { coldRoomsApi } from '@/api/endpoints'
import type { ColdRoom, ColdRoomPrediction, ColdRoomStatus, Device, TelemetryRange } from '@/api/types'
import { DeviceControls } from '@/components/commands/DeviceControls'
import { ErrorState } from '@/components/common/States'
import { DeviceStatusBadge, ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fieldPresence, missingFields, missingLabel, type FieldPresence } from '@/lib/channel-readings'
import { formatDateTime, formatHumidity, formatNumber, formatRelative, formatTemp, formatVoltage } from '@/lib/format'
import { AI_RISK_LEVEL_LABEL, AI_VIOLATION_LABEL } from '@/lib/labels'
import { TEMP_STATE, fanState, tempState, type TempState } from '@/lib/room-status'
import { useDeviceCommands, withCommandedState } from '@/lib/device-commands'
import { usePreference } from '@/lib/usePreference'
import { cn } from '@/lib/utils'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, CircleCheck, Siren, Sparkles, TriangleAlert } from 'lucide-react'
import { type ComponentProps, type ReactNode } from 'react'
import { TemperatureChart } from './TemperatureChart'

const RANGES: { value: TelemetryRange; label: string; refreshMs: number }[] = [
  // Refresh about twice per bucket: new points appear without hammering
  // the API (the headline number above is live over the socket anyway).
  { value: '1h', label: '1 giờ', refreshMs: 30_000 },
  { value: '6h', label: '6 giờ', refreshMs: 150_000 },
  { value: '24h', label: '24 giờ', refreshMs: 450_000 },
]

const RANGE_VALUES = RANGES.map((r) => r.value)
const OPEN_CLOSED = ['open', 'closed'] as const

const NO_DATA = 'Không có dữ liệu'

/** A section heading that shows/hides what follows it. */
function SectionToggle({
  open,
  onToggle,
  controls,
  children,
}: {
  open: boolean
  onToggle: () => void
  controls: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="flex items-center gap-1.5 self-start rounded-md text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ChevronDown
        className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')}
        aria-hidden="true"
      />
      {children}
    </button>
  )
}

const TEMP_TEXT: Record<TempState, string> = {
  ok: 'text-foreground',
  out: 'text-destructive',
  fault: 'text-destructive',
  stale: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  )
}

type Latest = ColdRoomStatus['latest']

/** One device's controls, shown or hidden on its own (remembered per room and device). */
function RoomDeviceControls({
  prefKey,
  ...props
}: { prefKey: string } & Omit<ComponentProps<typeof DeviceControls>, 'open' | 'onOpenChange'>) {
  const [view, setView] = usePreference(prefKey, 'open', OPEN_CLOSED)
  return <DeviceControls {...props} open={view === 'open'} onOpenChange={(o) => setView(o ? 'open' : 'closed')} />
}

/**
 * Everything that needs a decision right now, worst first — so the operator
 * reads one list instead of scanning every number before reaching for the
 * controls below it.
 */
function roomIssues(
  room: ColdRoom,
  latest: Latest,
  state: TempState,
  prediction: ColdRoomPrediction | null | undefined,
): { text: string; severe: boolean }[] {
  const issues: { text: string; severe: boolean }[] = []
  const t = latest?.temperature
  if (state === 'out' && t != null) {
    issues.push(
      t > room.tempMax
        ? {
            text: `Nhiệt độ vượt trần ${formatTemp(t - room.tempMax)} (${formatTemp(t)} > ${formatTemp(room.tempMax)})`,
            severe: true,
          }
        : {
            text: `Nhiệt độ dưới sàn ${formatTemp(room.tempMin - t)} (${formatTemp(t)} < ${formatTemp(room.tempMin)})`,
            severe: true,
          },
    )
  }
  if (state === 'fault')
    issues.push({
      text: 'Cảm biến nhiệt độ lỗi — không có số đo hợp lệ',
      severe: true,
    })
  if (state === 'stale' && latest) {
    issues.push({
      text: `Mất tín hiệu: số đo cuối ${formatRelative(latest.ts)}`,
      severe: false,
    })
  }
  if (state === 'none')
    issues.push({
      text: 'Chưa nhận được số đo nào từ phòng này',
      severe: false,
    })
  if (latest?.doorOpen) issues.push({ text: 'Cửa đang mở', severe: false })
  if (fieldPresence(latest, 'fanPowerFault') === 'reported' && latest?.fanPowerFault) {
    issues.push({ text: 'Quạt đang bật nhưng mất nguồn', severe: true })
  }
  if (prediction?.willExceedThreshold) {
    issues.push({
      text: `AI dự báo ${AI_VIOLATION_LABEL[prediction.violationType].toLowerCase()} trong 15 phút tới (${formatTemp(prediction.predictedTemp15m)})`,
      severe: prediction.riskLevel === 'CRITICAL',
    })
  }
  const missing = missingFields(latest)
  if (missing.length > 0)
    issues.push({
      text: `Thiếu dữ liệu ${missingLabel(missing)}`,
      severe: false,
    })
  return issues.sort((a, b) => Number(b.severe) - Number(a.severe))
}

/**
 * One cold room, shown in place on the monitoring page: the situation and
 * what needs attention first, then the AI forecast and the controls that act
 * on it, then the history (chart) and the devices behind the numbers.
 * Alerts live in the page's alert column, filtered to this room.
 */
export function RoomFocus({
  room,
  warehouseName,
  status,
  devices,
  now,
}: {
  room: ColdRoom
  warehouseName: string
  status: ColdRoomStatus | undefined
  devices: Device[]
  now: number
}) {
  // View choices are remembered per room in this browser (survive reloads).
  const pref = (name: string) => `monitoring:room:${room.id}:${name}`
  const [range, setRange] = usePreference<TelemetryRange>(pref('range'), '6h', RANGE_VALUES)
  const [devicesView, setDevicesView] = usePreference(pref('devices'), 'open', OPEN_CLOSED)
  const refreshMs = RANGES.find((r) => r.value === range)!.refreshMs
  const series = useQuery({
    queryKey: ['cold-rooms', room.id, 'telemetry', range],
    queryFn: () => coldRoomsApi.telemetry(room.id, range),
    refetchInterval: refreshMs,
    placeholderData: keepPreviousData,
  })
  const prediction = series.data?.prediction

  const reported = status?.latest ?? null
  const state = tempState(reported, now)
  // The device behind the reading (older servers omit deviceId: then only a
  // one-device room is unambiguous). A command it acked after that reading
  // already changed its actuators, so show that rather than wait for the
  // next sample — a stale reading is left as is (shown faded, as history).
  const source = devices.find((d) => d.id === reported?.deviceId) ?? (devices.length === 1 ? devices[0] : undefined)
  const commands = useDeviceCommands(source, true)
  const latest = state === 'stale' ? reported : withCommandedState(reported, commands.actuators, commands.lastByChannel)
  const fan = fanState(latest)
  // Only stats for channels the device has; a declared one that sent nothing
  // is flagged rather than shown as a plain dash.
  const humidity: FieldPresence = fieldPresence(latest, 'humidity')
  const fanOn: FieldPresence = fieldPresence(latest, 'fanOn')
  const alarm: FieldPresence = fieldPresence(latest, 'alarmActive')
  const issues = roomIssues(room, latest, state, prediction)
  const activeAlerts = status?.activeAlerts ?? 0
  const headingId = `room-${room.id}-heading`
  const devicesId = `room-${room.id}-devices`

  return (
    <Card className="gap-6 px-4 py-4 sm:px-5" aria-labelledby={headingId} role="region">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold break-words">
            {room.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {warehouseName} · Ngưỡng {formatTemp(room.tempMin)} – {formatTemp(room.tempMax)}
            {latest && (
              <>
                {' · '}cập nhật{' '}
                <time dateTime={latest.ts} title={formatDateTime(latest.ts)}>
                  {formatRelative(latest.ts)}
                </time>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeAlerts > 0 && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-destructive">
              <Siren className="size-4" aria-hidden="true" />
              {formatNumber(activeAlerts)} cảnh báo chưa xử lý
            </span>
          )}
          <ToneBadge tone={TEMP_STATE[state].tone}>{TEMP_STATE[state].label}</ToneBadge>
        </div>
      </header>

      {/* Situation: the headline number, then the state of everything that drives it. */}
      {/* A stale reading is shown faded and labelled: the room may have changed since. */}
      {state === 'stale' && latest && (
        <p className="-mb-3 flex items-center gap-1.5 text-sm font-medium text-warning">
          <TriangleAlert className="size-4" aria-hidden="true" />
          Số liệu dưới đây là của {formatRelative(latest.ts)}, có thể không còn đúng.
        </p>
      )}
      <section
        aria-label="Tình hình hiện tại"
        className={cn('flex flex-col gap-3 sm:flex-row sm:items-stretch', state === 'stale' && 'opacity-55')}
      >
        <div className="flex shrink-0 flex-col justify-center rounded-lg border bg-muted/40 px-4 py-3 sm:w-44">
          <p className="text-sm text-muted-foreground">Nhiệt độ</p>
          <p className={cn('text-4xl font-bold tabular-nums', TEMP_TEXT[state])}>
            {latest?.temperature != null ? formatTemp(latest.temperature) : '—'}
          </p>
          {humidity === 'reported' && (
            <p className="text-sm text-muted-foreground tabular-nums">Độ ẩm {formatHumidity(latest?.humidity)}</p>
          )}
        </div>
        <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <Stat
            label="Cửa"
            value={latest ? (latest.doorOpen ? 'Đang mở' : 'Đóng') : '—'}
            tone={latest?.doorOpen ? 'text-warning' : undefined}
          />
          {fanOn !== 'hidden' && (
            <Stat
              label="Quạt"
              value={
                fan ? (
                  <>
                    {fan.label}
                    {/* Measured with the reading: meaningless once a newer command flipped the fan. */}
                    {fieldPresence(latest, 'fanVoltage') === 'reported' && latest?.fanOn === reported?.fanOn && (
                      <span className="ml-1 text-sm font-normal text-muted-foreground">
                        {formatVoltage(latest?.fanVoltage)}
                      </span>
                    )}
                  </>
                ) : (
                  NO_DATA
                )
              }
              tone={fan?.fault ? 'text-destructive' : fanOn === 'missing' ? 'text-warning' : undefined}
            />
          )}
          {alarm !== 'hidden' && (
            <Stat
              label="Còi"
              value={alarm === 'missing' ? NO_DATA : latest?.alarmActive ? 'Đang kêu' : 'Im lặng'}
              tone={alarm === 'missing' || latest?.alarmActive ? 'text-warning' : undefined}
            />
          )}
          {humidity === 'missing' && <Stat label="Độ ẩm" value={NO_DATA} tone="text-warning" />}
        </div>
      </section>

      {/* What's wrong next to what the AI expects, before the history. */}
      <div className={cn('grid gap-4 xl:items-start', prediction && 'xl:grid-cols-2')}>
        {issues.length > 0 ? (
          <section
            aria-label="Cần chú ý"
            className={cn(
              'rounded-lg border px-3.5 py-2.5',
              issues.some((i) => i.severe)
                ? 'border-destructive/40 bg-destructive/5'
                : 'border-warning/50 bg-warning/10',
            )}
          >
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
              <TriangleAlert className="size-4" aria-hidden="true" />
              Cần chú ý
            </h3>
            <ul className="flex flex-col gap-0.5 text-sm">
              {issues.map((i) => (
                <li key={i.text} className={cn('flex gap-1.5', i.severe && 'font-medium text-destructive')}>
                  <span aria-hidden="true">•</span>
                  {i.text}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-4" aria-hidden="true" />
            Mọi chỉ số đang bình thường.
          </p>
        )}

        {prediction && (
          <section
            aria-label="Dự báo AI"
            className={cn(
              'flex flex-col gap-2 rounded-xl border p-3.5 transition-colors',
              prediction.willExceedThreshold
                ? 'border-warning/50 bg-warning/10 dark:border-warning/40 dark:bg-warning/15'
                : 'border-purple-500/20 bg-purple-50/50 dark:border-purple-500/30 dark:bg-purple-950/20',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                <span className="text-sm font-semibold">Dự báo AI (15 phút tới)</span>
              </div>
              {prediction.willExceedThreshold ? (
                <ToneBadge tone="warning">{AI_VIOLATION_LABEL[prediction.violationType]}</ToneBadge>
              ) : (
                <ToneBadge tone="success">Nhiệt độ ổn định</ToneBadge>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">{formatTemp(prediction.predictedTemp15m)}</span>
              <span className="text-xs text-muted-foreground">
                (Mức độ rủi ro: {AI_RISK_LEVEL_LABEL[prediction.riskLevel]})
              </span>
            </div>
            {prediction.recommendation && (
              <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Khuyến nghị:</span> {prediction.recommendation}
              </p>
            )}
          </section>
        )}
      </div>

      <section className="flex flex-col gap-3" aria-label="Nhiệt độ theo thời gian">
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

      {devices.map((d) => (
        <RoomDeviceControls
          key={d.id}
          prefKey={pref(`controls:${d.id}`)}
          device={d}
          // This device's own state only; a stale reading says nothing about
          // the actuators now (no state shown).
          reading={d.id === source?.id ? (state === 'stale' ? null : latest) : undefined}
          title={
            <h3 className="font-semibold">
              Điều khiển
              {devices.length > 1 && (
                <span className="ml-2 font-mono text-sm font-normal text-muted-foreground" translate="no">
                  {d.uniqueId}
                </span>
              )}
            </h3>
          }
        />
      ))}

      <section className="flex flex-col gap-2" aria-label="Thiết bị">
        <SectionToggle
          open={devicesView === 'open'}
          onToggle={() => setDevicesView(devicesView === 'open' ? 'closed' : 'open')}
          controls={devicesId}
        >
          <h3 className="font-semibold">Thiết bị ({devices.length})</h3>
        </SectionToggle>
        {devicesView === 'closed' ? null : devices.length === 0 ? (
          <p id={devicesId} className="text-muted-foreground">
            Phòng này chưa lắp thiết bị.
          </p>
        ) : (
          <div id={devicesId} className="rounded-lg border">
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
    </Card>
  )
}
