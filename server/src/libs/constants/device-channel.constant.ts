export enum ChannelType {
  LIMIT_SWITCH = 'limit_switch',
  TEMP_HUMIDITY_SENSOR = 'temp_humidity_sensor',
  CURRENT_SENSOR = 'current_sensor',
  FAN_MOTOR = 'fan_motor',
  INDICATOR_LIGHT = 'indicator_light',
  BUZZER = 'buzzer',
}

export enum ChannelRole {
  SENSOR = 'sensor',
  ACTUATOR = 'actuator',
}

// Derived server-side from channelType (never accepted from the client) so a
// channel can't be created with a role that contradicts its type.
export const CHANNEL_TYPE_ROLE: Record<ChannelType, ChannelRole> = {
  [ChannelType.LIMIT_SWITCH]: ChannelRole.SENSOR,
  [ChannelType.TEMP_HUMIDITY_SENSOR]: ChannelRole.SENSOR,
  [ChannelType.CURRENT_SENSOR]: ChannelRole.SENSOR,
  [ChannelType.FAN_MOTOR]: ChannelRole.ACTUATOR,
  [ChannelType.INDICATOR_LIGHT]: ChannelRole.ACTUATOR,
  [ChannelType.BUZZER]: ChannelRole.ACTUATOR,
};

// The channels of the one board model in use (firmware/cold_room_monitor):
// what a device gets on claim, so nobody has to declare them by hand. Order
// = display order. Edit per device afterwards if a board is wired differently.
export const DEVICE_DEFAULT_CHANNELS: readonly {
  channelType: ChannelType;
  label: string;
}[] = [
  { channelType: ChannelType.TEMP_HUMIDITY_SENSOR, label: 'Cảm biến nhiệt ẩm' },
  { channelType: ChannelType.LIMIT_SWITCH, label: 'Công tắc cửa' },
  { channelType: ChannelType.CURRENT_SENSOR, label: 'Nguồn quạt' },
  { channelType: ChannelType.FAN_MOTOR, label: 'Quạt làm lạnh' },
  { channelType: ChannelType.BUZZER, label: 'Còi báo động' },
];

// Which declared channel each optional telemetry field belongs to. Readers
// (UI) show a field only for a device that declares its channel, and flag
// it when the channel is declared but the field never arrives. temperature
// and doorOpen are not listed: every device must report them.
export const TELEMETRY_FIELD_CHANNEL = {
  humidity: ChannelType.TEMP_HUMIDITY_SENSOR,
  fanOn: ChannelType.FAN_MOTOR,
  fanVoltage: ChannelType.CURRENT_SENSOR,
  fanPowerFault: ChannelType.CURRENT_SENSOR,
  alarmActive: ChannelType.BUZZER,
} as const;
