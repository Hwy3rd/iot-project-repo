import {
  deviceTopicFilter,
  parseDeviceTopic,
} from '../../libs/mqtt/device-topics';

export const DEVICE_TELEMETRY_TOPIC_FILTER = deviceTopicFilter('telemetry');

// e.g. "devices/esp32-a1b2c3/telemetry" -> "esp32-a1b2c3"; null for any
// other topic (the shared client also delivers command acks here).
export function parseDeviceUniqueIdFromTopic(topic: string): string | null {
  return parseDeviceTopic(topic, 'telemetry');
}
