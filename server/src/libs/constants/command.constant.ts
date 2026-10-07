// on/off override the channel's automatic logic on the device for a while
// (firmware: MANUAL_OVERRIDE_MS); auto ends that override right away.
export enum CommandAction {
  ON = 'on',
  OFF = 'off',
  AUTO = 'auto',
}

// pending    — saved, not yet handed to the broker (broker down, or the
//              publish timed out); the retry sweep picks it up.
// sent       — published at least once, waiting for the device's ack.
// done/failed — the device acked it (failed carries error_reason).
// expired    — no ack before expires_at; the device may or may not have
//              run it, its telemetry is the source of truth from here.
// superseded — a newer command for the same channel replaced it before it
//              finished, so it must not run afterwards.
export enum CommandStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DONE = 'done',
  FAILED = 'failed',
  EXPIRED = 'expired',
  SUPERSEDED = 'superseded',
}

// States a command can still leave; everything else is final.
export const OPEN_COMMAND_STATUSES = [
  CommandStatus.PENDING,
  CommandStatus.SENT,
] as const;

// A command is only worth running within this window — a fan switched on
// minutes after someone asked for it is a surprise, not a fix. The device
// also refuses a command whose expiresAt has passed.
export const COMMAND_TTL_MS = 60 * 1000;

// Re-publish an unacked command this often, at most this many publishes in
// total (the first one included). The device dedupes by command id, so a
// re-publish never runs the action twice.
export const COMMAND_RETRY_INTERVAL_MS = 10 * 1000;
export const COMMAND_MAX_ATTEMPTS = 5;

// How long a publish may wait for the broker's PUBACK before the command is
// left pending for the retry sweep instead of blocking the caller.
export const COMMAND_PUBLISH_TIMEOUT_MS = 3 * 1000;
