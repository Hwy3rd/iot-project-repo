import { refreshSession } from '@/api/client'
import { io, type Socket } from 'socket.io-client'
import { env } from './env'

// One Socket.IO connection per tab, opened on first use. Auth rides on the
// httpOnly access_token cookie sent with the handshake (RealtimeGateway).

let socket: Socket | undefined
// Warehouse rooms wanted by mounted views, with how many views want each:
// a room is left only when the last view releases it, and all of them are
// re-joined after a reconnect (the server forgets rooms on disconnect).
const wanted = new Map<string, number>()
let authRetries = 0
const RETRY_AFTER_MS = 5_000

export function getSocket(): Socket {
  if (socket) return socket
  const s = io(env.socketUrl, { withCredentials: true, autoConnect: false })

  s.on('connect', () => {
    authRetries = 0
    for (const warehouseId of wanted.keys()) s.emit('join:warehouse', { warehouseId })
  })

  // The handshake is refused once the access token has expired, and
  // socket.io doesn't retry a refused handshake by itself. Refresh through
  // REST (which rotates the cookie) and try again — once, so a dead session
  // doesn't loop; the REST side announces that separately. If the refresh
  // itself couldn't get through, try the whole thing again a bit later.
  s.on('connect_error', (error) => {
    if (error.message !== 'Unauthorized' || authRetries > 0) return
    authRetries++
    void refreshSession().then((outcome) => {
      if (outcome === 'refreshed' && wanted.size > 0) s.connect()
      if (outcome === 'unavailable') {
        setTimeout(() => {
          authRetries = 0
          if (wanted.size > 0 && !s.connected) s.connect()
        }, RETRY_AFTER_MS)
      }
    })
  })

  socket = s
  return s
}

/** Joins the warehouses' rooms (connecting if needed); call the result to release them. */
export function joinWarehouses(warehouseIds: readonly string[]): () => void {
  const s = getSocket()
  for (const id of warehouseIds) {
    const count = wanted.get(id) ?? 0
    wanted.set(id, count + 1)
    if (count === 0 && s.connected) s.emit('join:warehouse', { warehouseId: id })
  }
  if (!s.connected && !s.active) s.connect()

  return () => {
    for (const id of warehouseIds) {
      const count = (wanted.get(id) ?? 1) - 1
      if (count > 0) {
        wanted.set(id, count)
        continue
      }
      wanted.delete(id)
      if (s.connected) s.emit('leave:warehouse', { warehouseId: id })
    }
    if (wanted.size === 0) s.disconnect()
  }
}

/** On login/logout/expiry: the socket belongs to the previous identity. */
export function disconnectSocket() {
  wanted.clear()
  socket?.disconnect()
  socket = undefined
}
