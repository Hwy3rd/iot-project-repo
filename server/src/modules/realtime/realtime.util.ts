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
