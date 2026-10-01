export const REDIS_CLIENT = 'REDIS_CLIENT';

// Single-session store: sha256 of the user's current refresh token (see
// AuthService). Deleting it ends the session at the next refresh.
export const refreshSessionKey = (userId: string) => `refresh:${userId}`;

// Present while a user's access must be refused immediately (locked or
// deleted account), even though their already-issued access token is still
// cryptographically valid until it expires. Checked on every authenticated
// request (JwtStrategy) and socket handshake (RealtimeGateway). No TTL: it
// mirrors the account state and is removed only on unlock.
export const blockedUserKey = (userId: string) => `blocked:${userId}`;

// Failed-login throttle (LoginRateLimiterService; buckets in
// libs/constants/auth.constant.ts). Keyed by the normalized username rather
// than the user id so an unknown username is throttled exactly like a real
// one. Lowercased because MySQL's default collation matches usernames
// case-insensitively ("Admin" and "admin" are one account);
// encodeURIComponent keeps a ':' in a username from colliding with the
// keys' own separators.
export const loginThrottleAccount = (username: string) =>
  encodeURIComponent(username.trim().toLowerCase());

// Failures counted in one bucket; `id` is the account, the IP, or
// "<account>:<ip>" for account_ip.
export const loginFailKey = (scope: string, id: string) =>
  `login:fail:${scope}:${id}`;

// How many times that bucket has filled lately — drives the escalating
// lockout.
export const loginStrikeKey = (scope: string, id: string) =>
  `login:strike:${scope}:${id}`;

// Present (TTL = the longest current lockout) while any bucket tied to this
// account is full — what the Users page reads to show a temporary block.
export const loginBlockedKey = (account: string) => `login:blocked:${account}`;

// Latest AI forecast for a cold room, written after each ingested reading
// (TelemetryService) and read by the chart (ColdRoomStatusService). Expires
// after AI_PREDICTION_TTL_SECONDS, so a room whose devices stopped
// reporting shows no forecast instead of a stale one.
export const aiPredictionKey = (coldRoomId: string) =>
  `ai:prediction:${coldRoomId}`;
