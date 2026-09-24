import { parseCorsOrigins } from '../../libs/constants/cors.constant';

// Minimal `key=value; key2=value2` cookie header parser — avoids adding a
// dependency (e.g. `cookie`) just for this; socket.io's handshake only gives
// us the raw header, not cookie-parser's already-parsed req.cookies.
export const readCookie = (
  cookieHeader: string | undefined,
  name: string,
): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return null;
};

export const warehouseRoom = (warehouseId: string): string =>
  `warehouse:${warehouseId}`;

// Every user's sockets join this room on connect, so events meant for one
// person (their own chatbot conversations) reach all of their open tabs and
// nobody else.
export const userRoom = (userId: string): string => `user:${userId}`;

// Shared by every @WebSocketGateway on the default namespace: Nest attaches
// them all to one socket.io server, so they must not disagree on options.
export const REALTIME_GATEWAY_OPTIONS = {
  cors: {
    origin: parseCorsOrigins(),
    credentials: true,
  },
};
