export const REDIS_CLIENT = 'REDIS_CLIENT';

// Single-session store: sha256 of the user's current refresh token (see
// AuthService). Deleting it ends the session at the next refresh.
export const refreshSessionKey = (userId: string) => `refresh:${userId}`;
