// Browser origins allowed to make credentialed (cookie) requests, from
// CORS_ORIGINS (comma-separated, exact match — "*" is not allowed alongside
// credentials). Shared by REST (main.ts) and socket.io
// (REALTIME_GATEWAY_OPTIONS) so the two can't drift apart.
export const parseCorsOrigins = (): string[] =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
