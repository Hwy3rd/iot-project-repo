export const env = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api',
  // undefined → socket.io connects to the page origin.
  socketUrl: (import.meta.env.VITE_SOCKET_URL as string | undefined) || undefined,
}
