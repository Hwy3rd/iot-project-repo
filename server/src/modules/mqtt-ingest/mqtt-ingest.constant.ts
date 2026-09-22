// Single-level wildcard (`+`) matches exactly one topic segment, i.e. one
// device's `unique_id` — see docs/DATABASE_DESIGN.md for why devices are
// addressed by `unique_id` here rather than the internal `id` (a device only
// knows its own hardware id, never the server-generated UUID).
export const DEVICE_TELEMETRY_TOPIC_FILTER = 'devices/+/telemetry';

// Pulls the `unique_id` back out of a concrete topic the filter matched,
// e.g. "devices/esp32-a1b2c3/telemetry" -> "esp32-a1b2c3". Returns null for
// anything that doesn't match the expected 3-segment shape, so a malformed
// or unrelated topic is skipped instead of crashing the handler.
export function parseDeviceUniqueIdFromTopic(topic: string): string | null {
  const segments = topic.split('/');
  if (
    segments.length !== 3 ||
    segments[0] !== 'devices' ||
    segments[2] !== 'telemetry' ||
    !segments[1]
  ) {
    return null;
  }
  return segments[1];
}
