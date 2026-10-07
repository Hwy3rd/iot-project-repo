import { devicesApi } from '@/api/endpoints'
import type { ChannelType, ColdRoomSeries, Device, DeviceChannel, TelemetryRaw } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState, Spinner } from '@/components/common/States'
import { DeviceStatusBadge } from '@/components/common/StatusBadge'
import { TemperatureChart } from '@/components/monitoring/TemperatureChart'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DeviceControls } from '@/components/commands/DeviceControls'
import { DEFAULT_CHANNEL_TYPES } from '@/lib/channel-readings'
import { dayjs, formatDateTime, formatHumidity, formatRelative, formatTemp, formatVoltage } from '@/lib/format'
import { STALE_AFTER_MS, fanState } from '@/lib/room-status'
import { mutationErrorText } from '@/lib/forms'
import {
  CHANNEL_ROLE_LABEL,
  CHANNEL_TYPE_LABEL,
  DEVICE_STATUS_TRIGGER_LABEL,
  FAN_FAULT_LABEL,
} from '@/lib/labels'
import { useColdRoomLookup, useUserLookup } from '@/lib/lookups'
import { cn } from '@/lib/utils'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Loader2, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

type TabKey = 'info' | 'channels' | 'history' | 'telemetry'

/**
 * The device detail: facts plus, where the caller's role may read them
 * (docs/RBAC.md), its channels, status history and temperature.
 */
export function DeviceDetailTabs({ device, info }: { device: Device; info: ReactNode }) {
  const { user } = useAuth()
  const role = user?.role
  const logs = hasRole(role, ['admin', 'manager', 'technician'])
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'info', label: 'Thông tin' },
    { key: 'channels', label: 'Kênh' },
    ...(logs ? [{ key: 'history' as const, label: 'Lịch sử trạng thái' }] : []),
    // Readings need the device in a room.
    ...(device.coldRoomId ? [{ key: 'telemetry' as const, label: 'Nhiệt độ' }] : []),
  ]
  const [tab, setTab] = useState<TabKey>('info')
  const baseId = useId()

  return (
    <div className="flex flex-col gap-4">
      <DeviceControls device={device} title={<h3 className="font-semibold">Điều khiển nhanh</h3>} />
      <div role="tablist" aria-label="Thông tin thiết bị" className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${baseId}-${t.key}-tab`}
            aria-selected={tab === t.key}
            aria-controls={`${baseId}-${t.key}-panel`}
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-${tab}-panel`} aria-labelledby={`${baseId}-${tab}-tab`}>
        {tab === 'info' && info}
        {tab === 'channels' && <ChannelsPanel device={device} />}
        {tab === 'history' && <StatusHistoryPanel device={device} />}
        {tab === 'telemetry' && <TelemetryPanel device={device} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

const CHANNEL_TYPES = Object.keys(CHANNEL_TYPE_LABEL) as ChannelType[]
// Mirrors the server's CHANNEL_TYPE_ROLE: only these take commands.
const ACTUATOR_TYPES: ChannelType[] = ['fan_motor', 'indicator_light', 'buzzer']
// Grouped so it's clear which channels can be controlled — adding only
// sensors leaves the device with nothing to send a command to.
const CHANNEL_TYPE_GROUPS = [
  { label: 'Điều khiển (nhận lệnh)', types: CHANNEL_TYPES.filter((t) => ACTUATOR_TYPES.includes(t)) },
  { label: 'Cảm biến (chỉ đọc)', types: CHANNEL_TYPES.filter((t) => !ACTUATOR_TYPES.includes(t)) },
]

const LATEST_REFRESH_MS = 15_000

interface ChannelReading {
  text: string
  /** ok = normal value, alert = the value itself is bad, missing = declared but not sent. */
  tone: 'ok' | 'alert' | 'missing' | 'muted'
}

const READING_TONE: Record<ChannelReading['tone'], string> = {
  ok: 'text-foreground',
  alert: 'font-medium text-destructive',
  missing: 'font-medium text-warning',
  muted: 'text-muted-foreground',
}

const MISSING_HINT = 'Kênh đã khai báo nhưng thiết bị không gửi dữ liệu — kiểm tra firmware hoặc dây cảm biến'
const NO_DATA: ChannelReading = { text: 'Không có dữ liệu', tone: 'missing' }

// What the device's latest sample says about one channel. A declared channel
// whose field is null is flagged — e.g. a board on firmware that predates it.
function channelReading(type: ChannelType, s: TelemetryRaw): ChannelReading {
  switch (type) {
    case 'temp_humidity_sensor': {
      if (s.sensorFault || s.temperature == null) return { text: 'Lỗi cảm biến', tone: 'alert' }
      const temp = formatTemp(s.temperature)
      return s.humidity == null
        ? { text: `${temp} · không có độ ẩm`, tone: 'missing' }
        : { text: `${temp} · ${formatHumidity(s.humidity)}`, tone: 'ok' }
    }
    case 'limit_switch':
      return s.doorOpen ? { text: 'Cửa đang mở', tone: 'alert' } : { text: 'Cửa đóng', tone: 'ok' }
    case 'current_sensor':
      if (s.fanVoltage == null) return NO_DATA
      return s.fanPowerFault
        ? {
            text: `${formatVoltage(s.fanVoltage)} · ${((s.fanFault && FAN_FAULT_LABEL[s.fanFault]) || 'mất nguồn').toLowerCase()}`,
            tone: 'alert',
          }
        : { text: formatVoltage(s.fanVoltage), tone: 'ok' }
    case 'fan_motor': {
      if (s.fanOn == null) return NO_DATA
      const fan = fanState(s)
      return { text: fan?.label ?? (s.fanOn ? 'Quạt chạy' : 'Quạt tắt'), tone: fan?.fault ? 'alert' : 'ok' }
    }
    case 'buzzer':
      if (s.alarmActive == null) return NO_DATA
      return s.alarmActive ? { text: 'Đang báo động', tone: 'alert' } : { text: 'Tắt', tone: 'ok' }
    case 'indicator_light':
      return { text: 'Thiết bị không báo trạng thái kênh này', tone: 'muted' }
  }
}

function ChannelsPanel({ device }: { device: Device }) {
  const { user } = useAuth()
  const canManage = hasRole(user?.role, ['admin', 'technician']) && device.status !== 'decommissioned'
  const qc = useQueryClient()
  const channels = useQuery({
    queryKey: ['devices', device.id, 'channels'],
    queryFn: () => devicesApi.channels(device.id),
  })
  // Instant readings are Admin/Manager/Technician only (like raw telemetry).
  const canSeeReadings = hasRole(user?.role, ['admin', 'manager', 'technician'])
  const latest = useQuery({
    queryKey: ['devices', device.id, 'telemetry', 'latest'],
    queryFn: () => devicesApi.telemetryLatest(device.id),
    enabled: canSeeReadings,
    refetchInterval: LATEST_REFRESH_MS,
  })
  const [removing, setRemoving] = useState<DeviceChannel | null>(null)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['devices', device.id, 'channels'] })
  const addDefaults = useMutation({
    mutationFn: () => devicesApi.addDefaultChannels(device.id),
    onSuccess: () => {
      toast.success('Đã thêm các kênh mặc định')
      void invalidate()
    },
    onError: (err) => toast.error('Không thêm được kênh', { description: mutationErrorText(err) }),
  })
  const remove = useMutation({
    mutationFn: (c: DeviceChannel) => devicesApi.removeChannel(device.id, c.id),
    onSuccess: () => {
      toast.success('Đã xoá kênh')
      setRemoving(null)
      void invalidate()
    },
    onError: (err) => toast.error('Không xoá được kênh', { description: mutationErrorText(err) }),
  })

  if (channels.isPending) return <Spinner />
  if (channels.isError) return <ErrorState error={channels.error} onRetry={() => channels.refetch()} />

  const missingDefaults = DEFAULT_CHANNEL_TYPES.filter(
    (t) => !channels.data.some((c) => c.channelType === t),
  )
  const sample = canSeeReadings && latest.isSuccess ? latest.data : undefined
  // Judged at fetch time (refetched every LATEST_REFRESH_MS), keeping render pure.
  const stale = sample != null && latest.dataUpdatedAt - new Date(sample.ts).getTime() > STALE_AFTER_MS

  return (
    <div className="flex flex-col gap-3">
      {canSeeReadings && latest.isSuccess && (
        <p className={cn('text-sm', stale || !sample ? 'text-warning' : 'text-muted-foreground')}>
          {!sample
            ? 'Thiết bị chưa gửi dữ liệu nào.'
            : `Số đo gần nhất ${formatRelative(sample.ts)}${stale ? ' — thiết bị có thể đã mất kết nối' : ''}.`}
        </p>
      )}
      {channels.data.length === 0 ? (
        <p className="text-muted-foreground">Thiết bị chưa khai báo kênh nào.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {channels.data.map((c) => (
            <ChannelRow
              key={c.id}
              device={device}
              channel={c}
              canManage={canManage}
              onRemove={() => setRemoving(c)}
              reading={sample ? channelReading(c.channelType, sample) : null}
            />
          ))}
        </ul>
      )}
      {canManage && missingDefaults.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">
            Board chuẩn còn thiếu kênh:{' '}
            <span className="font-medium text-foreground">
              {missingDefaults.map((t) => CHANNEL_TYPE_LABEL[t]).join(', ')}
            </span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={addDefaults.isPending}
            onClick={() => addDefaults.mutate()}
          >
            {addDefaults.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            Thêm kênh mặc định
          </Button>
        </div>
      )}
      {canManage && <AddChannelForm device={device} onAdded={invalidate} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Xoá kênh này?"
        description="Lịch sử lệnh đã gửi tới kênh vẫn được giữ. Kênh không nhận lệnh mới nữa."
        confirmLabel="Xoá kênh"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </div>
  )
}

function ChannelRow({
  device,
  channel,
  canManage,
  onRemove,
  reading,
}: {
  device: Device
  channel: DeviceChannel
  canManage: boolean
  onRemove: () => void
  /** What the latest sample says about this channel; null when not shown. */
  reading: ChannelReading | null
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(channel.label ?? '')
  const save = useMutation({
    mutationFn: () => devicesApi.updateChannel(device.id, channel.id, { label: label.trim() || null }),
    onSuccess: () => {
      toast.success('Đã đổi tên kênh')
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['devices', device.id, 'channels'] })
    },
    onError: (err) => toast.error('Không lưu được', { description: mutationErrorText(err) }),
  })
  const typeLabel = CHANNEL_TYPE_LABEL[channel.channelType]

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={typeLabel}
            maxLength={100}
            aria-label={`Tên kênh ${typeLabel}`}
            className="h-8"
          />
          <Button type="submit" size="icon-sm" disabled={save.isPending} aria-label="Lưu tên kênh">
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={save.isPending}
            aria-label="Huỷ đổi tên"
            onClick={() => {
              setEditing(false)
              setLabel(channel.label ?? '')
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block font-medium break-words">{channel.label || typeLabel}</span>
          <span className="text-sm text-muted-foreground">
            {channel.label && `${typeLabel} · `}
            {CHANNEL_ROLE_LABEL[channel.channelRole]}
          </span>
          {reading && (
            <span
              className={cn(
                'mt-0.5 flex items-center gap-1 text-sm tabular-nums',
                READING_TONE[reading.tone],
              )}
              title={reading.tone === 'missing' ? MISSING_HINT : undefined}
            >
              {reading.tone === 'missing' && <TriangleAlert className="size-3.5" aria-hidden="true" />}
              {reading.text}
            </span>
          )}
        </span>
      )}
      {canManage && !editing && (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={`Đổi tên kênh ${channel.label || typeLabel}`} onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Xoá kênh ${channel.label || typeLabel}`} onClick={onRemove}>
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      )}
    </li>
  )
}

function AddChannelForm({ device, onAdded }: { device: Device; onAdded: () => void }) {
  const [channelType, setChannelType] = useState<ChannelType | ''>('')
  const [label, setLabel] = useState('')
  const add = useMutation({
    mutationFn: () =>
      devicesApi.createChannel(device.id, {
        channelType: channelType as ChannelType,
        label: label.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Đã thêm kênh')
      setChannelType('')
      setLabel('')
      onAdded()
    },
    onError: (err) => toast.error('Không thêm được kênh', { description: mutationErrorText(err) }),
  })

  return (
    <form
      className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (channelType) add.mutate()
      }}
    >
      <div className="flex flex-col gap-1.5 sm:w-48">
        <Label htmlFor="channel-type">Loại kênh</Label>
        <Select value={channelType} onValueChange={(v) => v && setChannelType(v as ChannelType)} disabled={add.isPending}>
          <SelectTrigger id="channel-type" className="w-full">
            <SelectValue placeholder="Chọn…" />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_TYPE_GROUPS.map((g) => (
              <SelectGroup key={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CHANNEL_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="channel-label">Tên hiển thị (không bắt buộc)</Label>
        <Input
          id="channel-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          placeholder="vd Quạt dàn lạnh 1"
          disabled={add.isPending}
        />
      </div>
      <Button type="submit" disabled={!channelType || add.isPending}>
        {add.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
        Thêm kênh
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Status history
// ---------------------------------------------------------------------------

const HISTORY_PAGE = 20

function StatusHistoryPanel({ device }: { device: Device }) {
  const { user } = useAuth()
  const users = useUserLookup(hasRole(user?.role, ['admin']))
  const history = useInfiniteQuery({
    queryKey: ['devices', device.id, 'status-history'],
    queryFn: ({ pageParam }) => devicesApi.statusHistory(device.id, { page: pageParam, limit: HISTORY_PAGE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  })
  const who = (id: string | null) => (!id ? 'Hệ thống' : id === user?.id ? 'Bạn' : users.label(id))

  if (history.isPending) return <Spinner />
  if (history.isError) return <ErrorState error={history.error} onRetry={() => history.refetch()} />
  const items = history.data.pages.flatMap((p) => p.items)
  if (items.length === 0) return <p className="text-muted-foreground">Chưa có lần chuyển trạng thái nào.</p>

  return (
    <div className="flex flex-col gap-2">
      <ol className="divide-y rounded-md border">
        {items.map((h) => (
          <li key={h.id} className="flex flex-col gap-1 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {h.oldStatus ? <DeviceStatusBadge status={h.oldStatus} /> : <span className="text-sm text-muted-foreground">Mới</span>}
              <ArrowRight className="size-3.5 text-muted-foreground" aria-label="chuyển sang" />
              <DeviceStatusBadge status={h.newStatus} />
            </div>
            <p className="text-sm text-muted-foreground">
              <time dateTime={h.changedAt}>{formatDateTime(h.changedAt)}</time> ·{' '}
              {DEVICE_STATUS_TRIGGER_LABEL[h.trigger]} · {who(h.changedBy)}
            </p>
            {h.reason && <p className="text-sm break-words">{h.reason}</p>}
          </li>
        ))}
      </ol>
      {history.hasNextPage && (
        <Button variant="ghost" size="sm" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
          {history.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden="true" />}
          Xem thêm
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

const RANGES = {
  '24h': { label: '24 giờ qua', hours: 24 },
  '7d': { label: '7 ngày qua', hours: 24 * 7 },
  '30d': { label: '30 ngày qua', hours: 24 * 30 },
} as const
type RangeKey = keyof typeof RANGES
const RAW_SHOWN = 20

function TelemetryPanel({ device }: { device: Device }) {
  const { user } = useAuth()
  const canRaw = hasRole(user?.role, ['admin', 'manager', 'technician'])
  const coldRooms = useColdRoomLookup()
  const room = coldRooms.get(device.coldRoomId)
  const [range, setRange] = useState<RangeKey>('24h')

  const hourly = useQuery({
    queryKey: ['devices', device.id, 'telemetry', 'hourly', range],
    queryFn: () => {
      const to = dayjs()
      return devicesApi.telemetryHourly(device.id, {
        from: to.subtract(RANGES[range].hours, 'hour').toISOString(),
        to: to.toISOString(),
      })
    },
  })
  const raw = useQuery({
    queryKey: ['devices', device.id, 'telemetry', 'raw'],
    queryFn: () => devicesApi.telemetryRaw(device.id),
    enabled: canRaw,
  })

  // TemperatureChart speaks the room series shape; an hour bucket is one point.
  const series: ColdRoomSeries | null =
    hourly.data && room
      ? {
          coldRoomId: room.id,
          from: dayjs().subtract(RANGES[range].hours, 'hour').toISOString(),
          to: dayjs().toISOString(),
          bucketMinutes: 60,
          tempMin: room.tempMin,
          tempMax: room.tempMax,
          points: hourly.data.map((h) => ({
            t: h.hourBucket,
            avg: h.avgTemp,
            min: h.minTemp,
            max: h.maxTemp,
            samples: h.sampleCount,
            outOfRange: h.outOfRangeCount,
            // Absent on hours rolled up before these counts existed.
            doorOpen: h.doorOpenCount ?? 0,
            sensorFault: h.sensorErrorCount,
            humidity: h.avgHumidity ?? null,
            fanPowerFault: h.fanPowerFaultCount ?? 0,
          })),
        }
      : null
  const latest = (raw.data ?? []).slice(-RAW_SHOWN).reverse()

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-labelledby="device-hourly-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="device-hourly-heading" className="font-medium">
            Nhiệt độ theo giờ
          </h3>
          <Select value={range} onValueChange={(v) => v && setRange(v as RangeKey)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Khoảng thời gian">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGES) as RangeKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {RANGES[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hourly.isPending || (hourly.isSuccess && !room) ? (
          <Spinner />
        ) : hourly.isError ? (
          <ErrorState error={hourly.error} onRetry={() => hourly.refetch()} />
        ) : (
          series && <TemperatureChart series={series} />
        )}
      </section>

      {canRaw && (
        <section className="flex flex-col gap-2" aria-labelledby="device-raw-heading">
          <h3 id="device-raw-heading" className="font-medium">
            Mẫu tức thời gần nhất <span className="font-normal text-muted-foreground">(1 giờ qua)</span>
          </h3>
          {raw.isPending ? (
            <Spinner />
          ) : raw.isError ? (
            <ErrorState error={raw.error} onRetry={() => raw.refetch()} />
          ) : latest.length === 0 ? (
            <p className="text-muted-foreground">Không có mẫu nào trong 1 giờ qua.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-3">Thời điểm</TableHead>
                    <TableHead className="text-right">Nhiệt độ</TableHead>
                    <TableHead className="text-right">Độ ẩm</TableHead>
                    <TableHead>Cửa</TableHead>
                    <TableHead>Quạt</TableHead>
                    <TableHead>Ghi chú</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latest.map((r) => (
                    <TableRow key={r.ts}>
                      <TableCell className="pl-3 tabular-nums">{dayjs(r.ts).format('HH:mm:ss')}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTemp(r.temperature)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatHumidity(r.humidity)}</TableCell>
                      <TableCell>{r.doorOpen ? 'Mở' : 'Đóng'}</TableCell>
                      <TableCell>{r.fanOn == null ? '—' : r.fanOn ? 'Bật' : 'Tắt'}</TableCell>
                      <TableCell className="text-sm">
                        {[
                          r.outOfRange && 'Vượt ngưỡng',
                          r.sensorFault && 'Lỗi cảm biến',
                          r.fanPowerFault && ((r.fanFault && FAN_FAULT_LABEL[r.fanFault]) || 'Mất nguồn quạt'),
                        ]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
