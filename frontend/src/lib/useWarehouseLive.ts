import { useEffect, useSyncExternalStore } from 'react'
import { getSocket, joinWarehouses } from './socket'

function subscribeConnection(onChange: () => void) {
  const s = getSocket()
  s.on('connect', onChange)
  s.on('disconnect', onChange)
  return () => {
    s.off('connect', onChange)
    s.off('disconnect', onChange)
  }
}

/**
 * Keeps the realtime rooms of the given warehouses joined while `enabled`
 * and returns whether the socket is currently connected (views keep polling
 * as a fallback). The events themselves are applied to the cache app-wide by
 * useLiveSync (AppShell), so every view showing the data updates.
 */
export function useWarehouseLive(warehouseIds: readonly string[], enabled: boolean): boolean {
  const key = [...new Set(warehouseIds)].sort().join()

  useEffect(() => {
    if (!enabled || !key) return
    return joinWarehouses(key.split(','))
  }, [enabled, key])

  const connected = useSyncExternalStore(subscribeConnection, () => getSocket().connected)
  return enabled && !!key && connected
}
