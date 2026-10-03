import type { ChannelType, TelemetryDeviceState } from '@/api/types'

/**
 * Which declared channel each optional telemetry field belongs to — mirrors
 * the server's TELEMETRY_FIELD_CHANNEL. temperature and doorOpen aren't
 * listed: every device must report them.
 */
export const TELEMETRY_FIELD_CHANNEL = {
  humidity: 'temp_humidity_sensor',
  fanOn: 'fan_motor',
  fanVoltage: 'current_sensor',
  fanPowerFault: 'current_sensor',
  alarmActive: 'buzzer',
} as const satisfies Record<keyof TelemetryDeviceState, ChannelType>

export type ReadingField = keyof typeof TELEMETRY_FIELD_CHANNEL

/** Names used in "missing data" warnings. */
export const READING_FIELD_LABEL: Record<ReadingField, string> = {
  humidity: 'độ ẩm',
  fanOn: 'trạng thái quạt',
  fanVoltage: 'điện áp quạt',
  fanPowerFault: 'nguồn quạt',
  alarmActive: 'còi',
}

/** Mirrors the server's DEVICE_DEFAULT_CHANNELS (types only). */
export const DEFAULT_CHANNEL_TYPES: ChannelType[] = [
  'temp_humidity_sensor',
  'limit_switch',
  'current_sensor',
  'fan_motor',
  'buzzer',
]

/**
 * - `reported`: the device declares the channel and sent a value.
 * - `missing`: declared, but the value didn't come — wrong/old firmware or a
 *   broken sensor; worth flagging.
 * - `hidden`: the device doesn't have that channel, so there's nothing to show.
 *
 * A device declaring no channels at all is shown as before (whatever it sends).
 */
export type FieldPresence = 'reported' | 'missing' | 'hidden'

export function fieldPresence(
  reading: (TelemetryDeviceState & { declaredChannels?: ChannelType[] }) | null | undefined,
  field: ReadingField,
): FieldPresence {
  if (!reading) return 'hidden'
  const value = reading[field]
  const declared = reading.declaredChannels ?? []
  if (declared.length === 0) return value != null ? 'reported' : 'hidden'
  if (!declared.includes(TELEMETRY_FIELD_CHANNEL[field])) return 'hidden'
  return value != null ? 'reported' : 'missing'
}

/** Fields the device declares but didn't send, for a single warning line. */
export function missingFields(
  reading: (TelemetryDeviceState & { declaredChannels?: ChannelType[] }) | null | undefined,
): ReadingField[] {
  return (Object.keys(TELEMETRY_FIELD_CHANNEL) as ReadingField[]).filter(
    (f) => fieldPresence(reading, f) === 'missing',
  )
}

/** "độ ẩm, trạng thái quạt" — one name per channel (fanVoltage/fanPowerFault share one). */
export function missingLabel(fields: ReadingField[]): string {
  const channels = new Set<ChannelType>()
  const names: string[] = []
  for (const f of fields) {
    const ch = TELEMETRY_FIELD_CHANNEL[f]
    if (channels.has(ch)) continue
    channels.add(ch)
    names.push(READING_FIELD_LABEL[f])
  }
  return names.join(', ')
}
