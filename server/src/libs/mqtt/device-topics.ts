// Per-device MQTT topics, all shaped `devices/{uniqueId}/{kind}`. Devices
// are addressed by `unique_id` rather than the internal `id` — see
// docs/DATABASE_DESIGN.md (a device only knows its own hardware id, never
// the server-generated UUID).
//   telemetry — device → server, sensor/actuator state
//   commands  — server → device, one Command per message
//   ack       — device → server, the outcome of a command
export type DeviceTopicKind = 'telemetry' | 'commands' | 'ack';

export function deviceTopic(uniqueId: string, kind: DeviceTopicKind): string {
  return `devices/${uniqueId}/${kind}`;
}

// Single-level wildcard (`+`) matches exactly one topic segment, i.e. one
// device's `unique_id`.
export function deviceTopicFilter(kind: DeviceTopicKind): string {
  return `devices/+/${kind}`;
}

// Pulls the `unique_id` back out of a concrete topic of the given kind, e.g.
// "devices/esp32-a1b2c3/ack" -> "esp32-a1b2c3". Returns null for anything
// else, so a handler sharing the client's single 'message' event skips
// topics that aren't its own instead of crashing on them.
export function parseDeviceTopic(
  topic: string,
  kind: DeviceTopicKind,
): string | null {
  const segments = topic.split('/');
  if (
    segments.length !== 3 ||
    segments[0] !== 'devices' ||
    segments[2] !== kind ||
    !segments[1]
  ) {
    return null;
  }
  return segments[1];
}
