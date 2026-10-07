import type { ColdRoomStatus, DeviceStatus } from '@/api/types'
import type { Tone } from '@/components/common/StatusBadge'
import { fieldPresence } from '@/lib/channel-readings'
import { FAN_FAULT_LABEL } from '@/lib/labels'

// A reading older than this is treated as "no signal": devices normally
// report much more often, so the room's real state is unknown.
export const STALE_AFTER_MS = 10 * 60_000

/**
 * How often the grids refetch their status. Management pages poll; second-
 * by-second updates belong to the dedicated live-monitoring screen (which
 * can use the realtime socket, see lib/useWarehouseLive.ts).
 */
export const STATUS_REFRESH_MS = 30_000

export type TempState = 'ok' | 'out' | 'fault' | 'stale' | 'none'

export const TEMP_STATE: Record<TempState, { label: string; tone: Tone }> = {
  ok: { label: 'Bình thường', tone: 'success' },
  out: { label: 'Vượt ngưỡng', tone: 'danger' },
  fault: { label: 'Lỗi cảm biến', tone: 'danger' },
  stale: { label: 'Mất tín hiệu', tone: 'warning' },
  none: { label: 'Chưa có dữ liệu', tone: 'neutral' },
}

/** Order used when summing rooms up per warehouse: worst first. */
export const TEMP_STATE_ORDER: TempState[] = ['out', 'fault', 'stale', 'none', 'ok']

export function tempState(latest: ColdRoomStatus['latest'], now = Date.now()): TempState {
  if (!latest) return 'none'
  if (now - new Date(latest.ts).getTime() > STALE_AFTER_MS) return 'stale'
  if (latest.sensorFault || latest.temperature === null) return 'fault'
  return latest.outOfRange ? 'out' : 'ok'
}

/**
 * Fan state from the latest reading, or null when there is none to show:
 * the device has no fan channel, or declares one but sent nothing (callers
 * flag that via fieldPresence). fanOn is whether the fan actually has power
 * (measured voltage); when it differs from the relay (fanRelayOn) the fan is
 * still spinning up or winding down. A supply fault comes first.
 */
export function fanState(
  latest: ColdRoomStatus['latest'],
): { label: string; tone: Tone; fault: boolean } | null {
  if (!latest || fieldPresence(latest, 'fanOn') !== 'reported') return null
  if (fieldPresence(latest, 'fanPowerFault') === 'reported' && latest.fanPowerFault) {
    const label = (latest.fanFault && FAN_FAULT_LABEL[latest.fanFault]) || 'Mất nguồn quạt'
    return { label, tone: 'danger', fault: true }
  }
  if (latest.fanRelayOn === true && !latest.fanOn) return { label: 'Quạt đang khởi động', tone: 'neutral', fault: false }
  if (latest.fanRelayOn === false && latest.fanOn) return { label: 'Quạt đang dừng', tone: 'neutral', fault: false }
  return latest.fanOn
    ? { label: 'Quạt chạy', tone: 'success', fault: false }
    : { label: 'Quạt tắt', tone: 'neutral', fault: false }
}

/** Devices that need attention, for the card footers. */
export const PROBLEM_DEVICE_STATUSES: DeviceStatus[] = ['offline', 'fault', 'maintenance']
