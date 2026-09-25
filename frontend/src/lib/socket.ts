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
// Views that need the connection itself, for events sent to the user's own
// room (every socket joins it on connect) rather than a warehouse room.
let holders = 0
const needed = () => wanted.size > 0 || holders > 0
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
      if (outcome === 'refreshed' && needed()) s.connect()
      if (outcome === 'unavailable') {
        setTimeout(() => {
          authRetries = 0
          if (needed() && !s.connected) s.connect()
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
    if (!needed()) s.disconnect()
  }
}

/** Keeps the socket connected for user-room events; call the result to let go. */
export function holdSocket(): () => void {
  const s = getSocket()
  holders++
  if (!s.connected && !s.active) s.connect()
  return () => {
    // disconnectSocket() may have reset the count since (logout).
    holders = Math.max(0, holders - 1)
    if (!needed()) s.disconnect()
  }
}

/** On login/logout/expiry: the socket belongs to the previous identity. */
export function disconnectSocket() {
  wanted.clear()
  holders = 0
  socket?.disconnect()
  socket = undefined
}
