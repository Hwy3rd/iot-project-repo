import { commandsApi, devicesApi } from '@/api/endpoints'
import type { ChannelType, Command, Device, DeviceChannel, TelemetryDeviceState } from '@/api/types'
import { useQuery } from '@tanstack/react-query'

/** Telemetry field that reports an actuator's real state; none for the light. */
export const STATE_FIELD: Partial<Record<ChannelType, 'fanOn' | 'alarmActive'>> = {
  fan_motor: 'fanOn',
  buzzer: 'alarmActive',
}

export const OPEN: Command['status'][] = ['pending', 'sent']
// Acks usually land within a second or two; poll fast only while one is due.
export const OPEN_REFRESH_MS = 2_000
const IDLE_REFRESH_MS = 30_000
const RECENT_COMMANDS = 20
// After an ack, how long to keep polling fast for the state that follows it.
export const SETTLE_MS = 15_000

/** A device's live state plus when it was sampled (to compare with acks). */
export type DeviceReading = TelemetryDeviceState & { ts?: string }

/**
 * A device's actuator channels and the newest command of each, polled fast
 * while one is in flight. Shared by the controls and by views that show the
 * actuators' state (they reuse the same cache entries).
 */
export function useDeviceCommands(device: Device | undefined, enabled: boolean) {
  const on = enabled && !!device
  const channels = useQuery({
    queryKey: ['devices', device?.id, 'channels'],
    queryFn: () => devicesApi.channels(device!.id),
    enabled: on,
  })
  const actuators = (channels.data ?? []).filter((c) => c.channelRole === 'actuator')
  const commands = useQuery({
    queryKey: ['commands', { deviceId: device?.id, limit: RECENT_COMMANDS }],
    queryFn: () => commandsApi.list({ deviceId: device!.id, limit: RECENT_COMMANDS }),
    enabled: on && actuators.length > 0,
    refetchInterval: (q) =>
      q.state.data?.items.some((c) => OPEN.includes(c.status)) ? OPEN_REFRESH_MS : IDLE_REFRESH_MS,
  })
  // Newest command per channel (the list is newest first).
  const lastByChannel = new Map<string, Command>()
  for (const c of commands.data?.items ?? []) {
    if (!lastByChannel.has(c.channelId)) lastByChannel.set(c.channelId, c)
  }
  return { channels, actuators, commands, lastByChannel }
}

/**
 * The reading with each actuator set to what its last command did, when the
 * device acked that command after the reading was taken. The firmware
 * switches the output before acking, so a `done` ack is the actuator's real
 * state until the next sample says otherwise — without this the UI shows the
 * old state until telemetry (and the socket) catch up.
 */
export function withCommandedState<T extends DeviceReading>(
  reading: T | null,
  actuators: DeviceChannel[],
  lastByChannel: Map<string, Command>,
): T | null {
  if (!reading) return reading
  const readAt = reading.ts ? Date.parse(reading.ts) : -Infinity
  let out = reading
  for (const ch of actuators) {
    const field = STATE_FIELD[ch.channelType]
    const last = lastByChannel.get(ch.id)
    if (!field || last?.status !== 'done' || !last.ackAt || Date.parse(last.ackAt) <= readAt) continue
    out = { ...out, [field]: last.action === 'on' }
  }
  return out
}
