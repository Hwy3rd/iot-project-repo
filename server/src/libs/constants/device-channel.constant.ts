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
