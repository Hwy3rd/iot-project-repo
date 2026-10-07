import { commandsApi, devicesApi } from '@/api/endpoints'
import type {
  ChannelType,
  Command,
  CommandAction,
  Device,
  DeviceChannel,
} from '@/api/types'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { Button } from '@/components/ui/button'
import { formatRelative } from '@/lib/format'
import { mutationErrorText } from '@/lib/forms'
import { CHANNEL_TYPE_LABEL, COMMAND_ACTION_LABEL, COMMAND_ERROR_LABEL } from '@/lib/labels'
import { cn } from '@/lib/utils'
import {
  MANUAL_FIELD,
  OPEN,
  actuatorOn,
  OPEN_REFRESH_MS,
  SETTLE_MS,
  useDeviceCommands,
  withCommandedState,
  type DeviceReading,
} from '@/lib/device-commands'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check, ChevronDown, Fan, Lightbulb, Loader2, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

const CHANNEL_ICON: Partial<Record<ChannelType, LucideIcon>> = {
  fan_motor: Fan,
  buzzer: BellRing,
  indicator_light: Lightbulb,
}

const STATE_LABEL: Partial<Record<ChannelType, [on: string, off: string]>> = {
  fan_motor: ['Đang chạy', 'Đang tắt'],
  buzzer: ['Đang kêu', 'Im lặng'],
}

/**
 * One-click on/off for every actuator channel of a device, with its live
 * state and how the last command went. Shown to whoever may send commands
 * (Admin, Technician, Staff on shift — the backend enforces the shift).
 *
 * `reading` is the device's latest state when the caller already has it live
 * (monitoring, over the socket); null = known to be unusable (stale); omitted
 * = fetched here for roles allowed to see instant readings.
 *
 * With `open`/`onOpenChange` the title becomes a toggle that hides the list.
 */
export function DeviceControls({
  device,
  reading,
  title,
  open = true,
  onOpenChange,
  className,
}: {
  device: Device
  reading?: DeviceReading | null
  /** Rendered only when there is something to control. */
  title?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const { user } = useAuth()
  const canControl = hasRole(user?.role, ['admin', 'technician', 'staff'])
  const canSeeReadings = hasRole(user?.role, ['admin', 'manager', 'technician'])
  const usable = canControl && !!device.coldRoomId && device.status !== 'decommissioned'

  const { channels, actuators, commands, lastByChannel } = useDeviceCommands(device, usable)
  const recent = commands.data?.items

  const latest = useQuery({
    queryKey: ['devices', device.id, 'telemetry', 'latest'],
    queryFn: () => devicesApi.telemetryLatest(device.id),
    enabled: usable && reading === undefined && canSeeReadings && actuators.length > 0,
    // The device reports every ~5 s: follow it closely while a command is in
    // flight and for a little while after its ack, until the new state shows.
    refetchInterval: () => {
      const now = Date.now()
      const settling = (recent ?? []).some(
        (c) => OPEN.includes(c.status) || (c.ackAt && now - Date.parse(c.ackAt) < SETTLE_MS),
      )
      return settling ? OPEN_REFRESH_MS : 15_000
    },
  })
  const state = withCommandedState(
    reading !== undefined ? reading : (latest.data ?? null),
    actuators,
    lastByChannel,
  )
  const contentId = useId()

  if (!usable) return null
  if (channels.isPending) return null
  const heading = onOpenChange ? (
    <button
      type="button"
      className="flex items-center gap-1.5 self-start rounded-md text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={() => onOpenChange(!open)}
    >
      <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden="true" />
      {title}
    </button>
  ) : (
    title
  )
  if (channels.isError) {
    // Staff off shift can't list a device's channels (403): say why instead
    // of silently showing nothing.
    const offShift = channels.error instanceof ApiError && channels.error.status === 403
    return offShift ? (
      <div className={cn('flex flex-col gap-2', className)}>
        {heading}
        {open && (
          <p id={contentId} className="text-sm text-muted-foreground">
            Cần đang trong ca trực tại kho này để điều khiển thiết bị.
          </p>
        )}
      </div>
    ) : null
  }
  if (actuators.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {heading}
      {open && (
        <div id={contentId} className="flex flex-col gap-2">
          {state?.configSynced === false && (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/40 px-3 py-2 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Thiết bị chưa nhận ngưỡng mới của phòng, còi tại chỗ đang báo theo ngưỡng cũ hoặc ngưỡng dự
              phòng. Thiết bị sẽ tự cập nhật khi kết nối lại broker.
            </p>
          )}
          <ul className="divide-y rounded-lg border">
            {actuators.map((ch) => (
              <ControlRow key={ch.id} channel={ch} state={state} last={lastByChannel.get(ch.id)} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Bật/Tắt ghi đè chế độ tự động của kênh trong 10 phút, sau đó thiết bị tự quay lại tự động. Bấm Tự
            động để trả lại ngay.
          </p>
        </div>
      )}
    </div>
  )
}

function ControlRow({
  channel,
  state,
  last,
}: {
  channel: DeviceChannel
  state: DeviceReading | null
  last: Command | undefined
}) {
  const typeLabel = CHANNEL_TYPE_LABEL[channel.channelType]
  const name = channel.label || typeLabel
  const qc = useQueryClient()
  const [sending, setSending] = useState<CommandAction | null>(null)
  const send = useMutation({
    mutationFn: (action: CommandAction) => commandsApi.create({ channelId: channel.id, action }),
    onMutate: (action) => setSending(action),
    onSettled: () => setSending(null),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['commands'] })
      if (c.status === 'pending') {
        toast.info(`${COMMAND_ACTION_LABEL[c.action]} ${name}: đang chờ gửi tới thiết bị`)
      }
    },
    onError: (err) =>
      toast.error(`Không gửi được lệnh cho ${name}`, {
        description: mutationErrorText(err, {
          403: 'Bạn không có quyền điều khiển thiết bị này (Staff cần đang trong ca trực).',
          409: 'Kênh này không nhận lệnh điều khiển.',
        }),
      }),
  })

  const Icon = CHANNEL_ICON[channel.channelType] ?? Lightbulb
  const on = actuatorOn(channel.channelType, state)
  const labels = STATE_LABEL[channel.channelType]
  const manualField = MANUAL_FIELD[channel.channelType]
  // null = the device doesn't report its mode (older firmware).
  const manualSec = manualField ? (state?.[manualField] ?? null) : null
  const auto = manualSec == null ? null : manualSec === 0
  const pressed = (action: CommandAction) =>
    action === 'auto' ? auto : auto === true || on == null ? null : on === (action === 'on')

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <Icon
        className={cn(
          'size-5 shrink-0',
          !on ? 'text-muted-foreground' : channel.channelType === 'buzzer' ? 'text-warning' : 'text-primary',
          on && channel.channelType === 'fan_motor' && 'motion-safe:animate-spin [animation-duration:2s]',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">
          {name}
          {on != null && labels && (
            <span
              className={cn(
                'ml-2 text-sm font-normal',
                !on ? 'text-muted-foreground' : channel.channelType === 'buzzer' ? 'font-medium text-warning' : 'text-primary',
              )}
            >
              {on ? labels[0] : labels[1]}
            </span>
          )}
        </p>
        {auto != null && (
          <p className="text-xs text-muted-foreground">
            {auto ? 'Chế độ tự động' : `Thủ công, còn khoảng ${Math.max(1, Math.ceil(manualSec! / 60))} phút`}
          </p>
        )}
        <LastCommand command={last} />
      </div>
      <div className="flex gap-1.5" role="group" aria-label={`Điều khiển ${name}`}>
        {(['on', 'off', 'auto'] as const).map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={pressed(action) ? 'secondary' : 'outline'}
            aria-pressed={pressed(action) ?? undefined}
            disabled={send.isPending}
            onClick={() => send.mutate(action)}
            aria-label={`${COMMAND_ACTION_LABEL[action]} ${name}`}
          >
            {sending === action && <Loader2 className="animate-spin" aria-hidden="true" />}
            {COMMAND_ACTION_LABEL[action]}
          </Button>
        ))}
      </div>
    </li>
  )
}

function LastCommand({ command: c }: { command: Command | undefined }) {
  if (!c) return null
  const action = COMMAND_ACTION_LABEL[c.action]
  const base = 'flex items-center gap-1 text-xs'
  switch (c.status) {
    case 'pending':
    case 'sent':
      return (
        <p className={cn(base, 'text-muted-foreground')} aria-live="polite">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {action}: {c.status === 'pending' ? 'đang chờ gửi…' : 'đang chờ thiết bị xác nhận…'}
        </p>
      )
    case 'done':
      return (
        <p className={cn(base, 'text-muted-foreground')} aria-live="polite">
          <Check className="size-3 text-success" aria-hidden="true" />
          {action}: đã thực hiện {formatRelative(c.ackAt ?? c.createdAt)}
        </p>
      )
    case 'failed':
      return (
        <p className={cn(base, 'font-medium text-destructive')} aria-live="polite">
          <TriangleAlert className="size-3" aria-hidden="true" />
          {action} thất bại: {c.errorReason ? (COMMAND_ERROR_LABEL[c.errorReason] ?? c.errorReason) : 'không rõ lý do'}
        </p>
      )
    case 'expired':
      return (
        <p className={cn(base, 'font-medium text-warning')} aria-live="polite">
          <TriangleAlert className="size-3" aria-hidden="true" />
          {action}: hết hạn, thiết bị không phản hồi
        </p>
      )
    case 'superseded':
      return null
  }
}
