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
