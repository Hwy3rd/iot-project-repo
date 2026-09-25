import type { ColdRoomStatus } from '@/api/types'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { getSocket, joinWarehouses } from './socket'

// Server event names/payloads: server/src/libs/constants/realtime.constant.ts.
interface ColdRoomReadingEvent {
  warehouseId: string
  coldRoomId: string
  deviceId: string
  latest: NonNullable<ColdRoomStatus['latest']>
}

const STATUS_KEY = ['cold-rooms', 'status'] as const

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
 * Live updates for the given warehouses while `enabled`: new readings are
 * written straight into every cached `['cold-rooms', 'status', …]` result,
 * and an alert change refetches statuses and alert lists. Returns whether
 * the socket is currently connected (views keep polling as a fallback).
 */
export function useWarehouseLive(warehouseIds: readonly string[], enabled: boolean): boolean {
  const qc = useQueryClient()
  const key = [...new Set(warehouseIds)].sort().join()

  useEffect(() => {
    if (!enabled || !key) return
    const s = getSocket()

    const onReading = (event: ColdRoomReadingEvent) => {
      qc.setQueriesData<ColdRoomStatus[]>({ queryKey: STATUS_KEY }, (rooms) =>
        rooms?.map((room) =>
          room.coldRoomId === event.coldRoomId &&
          // Events can overtake each other; never go back in time.
          (!room.latest || room.latest.ts <= event.latest.ts)
            ? { ...room, latest: event.latest }
            : room,
        ),
      )
    }
    const onAlertsChanged = () => {
      void qc.invalidateQueries({ queryKey: STATUS_KEY })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    }

    s.on('coldroom:reading', onReading)
    s.on('alerts:changed', onAlertsChanged)
    const release = joinWarehouses(key.split(','))
    return () => {
      s.off('coldroom:reading', onReading)
      s.off('alerts:changed', onAlertsChanged)
      release()
    }
  }, [enabled, key, qc])

  const connected = useSyncExternalStore(subscribeConnection, () => getSocket().connected)
  return enabled && !!key && connected
}
