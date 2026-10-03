import type { ColdRoomStatus, DeviceStatus } from '@/api/types'
import type { Tone } from '@/components/common/StatusBadge'
import { fieldPresence } from '@/lib/channel-readings'

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
 * flag that via fieldPresence). A power fault is only reported while the fan
 * is switched on — off with the door open is normal.
 */
export function fanState(
  latest: ColdRoomStatus['latest'],
): { label: string; tone: Tone; fault: boolean } | null {
  if (!latest || fieldPresence(latest, 'fanOn') !== 'reported') return null
  if (fieldPresence(latest, 'fanPowerFault') === 'reported' && latest.fanPowerFault) {
    return { label: 'Mất nguồn quạt', tone: 'danger', fault: true }
  }
  return latest.fanOn
    ? { label: 'Quạt chạy', tone: 'success', fault: false }
    : { label: 'Quạt tắt', tone: 'neutral', fault: false }
}

/** Devices that need attention, for the card footers. */
export const PROBLEM_DEVICE_STATUSES: DeviceStatus[] = ['offline', 'fault', 'maintenance']
