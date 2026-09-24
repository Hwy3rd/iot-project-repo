import type { Socket } from 'socket.io';
import type { UserRole } from '../../libs/constants/user.constant';

// What the handshake middleware puts on client.data — the same shape
// JwtStrategy puts on req.user for REST, minus the DB round-trip (same
// "don't hit the DB per request" reasoning as the REST access token — see
// server/CLAUDE.md), plus when the access token the socket was opened with
// expires (see SocketUser.tokenExpiresAt).
export interface SocketUser {
  id: string;
  username: string;
  role: UserRole;
  // Epoch ms. A socket outlives its access token; handlers that must honor
  // expiry the way REST does (e.g. chatbot:send, which costs an LLM call)
  // compare against this and make the client reconnect with a fresh cookie.
  tokenExpiresAt: number;
}

export interface SocketData {
  user?: SocketUser;
}

// Socket.io types client.data as `any` unless the 4th generic (SocketData)
// is filled in — this is what makes client.data.user a typed access instead
// of one, in every gateway.
export type AppSocket = Socket<
  Record<string, (...args: unknown[]) => void>,
  Record<string, (...args: unknown[]) => void>,
  Record<string, never>,
  SocketData
>;
