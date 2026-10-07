import type { ColdRoomStatus, Device, Paginated, TelemetryRaw } from '@/api/types'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useWarehouseLookup } from './lookups'
import { getSocket, joinWarehouses } from './socket'

// Server event names/payloads: server/src/libs/constants/realtime.constant.ts.
export interface ColdRoomReadingEvent {
  warehouseId: string
  coldRoomId: string
  deviceId: string
  latest: NonNullable<ColdRoomStatus['latest']>
}

const STATUS_KEY = ['cold-rooms', 'status'] as const

// Notifications for a new alert are written by the worker right after the
// alert itself; give it a moment before refreshing the bell.
const NOTIFICATIONS_DELAY_MS = 1_500

/**
 * Writes a new reading straight into every cache that shows it: the room
 * statuses (monitoring board, cold-room and warehouse grids) and the device's
 * own latest telemetry (device page, controls). A device listed as offline
 * that reports again is back online, so device lists are refetched then.
 */
export function applyReading(qc: QueryClient, event: ColdRoomReadingEvent) {
  qc.setQueriesData<ColdRoomStatus[]>({ queryKey: STATUS_KEY }, (rooms) =>
    rooms?.map((room) =>
      room.coldRoomId === event.coldRoomId &&
      // Events can overtake each other; never go back in time.
      (!room.latest || room.latest.ts <= event.latest.ts)
        ? { ...room, latest: event.latest }
        : room,
    ),
  )

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { declaredChannels, ...reading } = event.latest
  qc.setQueryData<TelemetryRaw | null>(['devices', event.deviceId, 'telemetry', 'latest'], (old) =>
    old === undefined || (old && old.ts > reading.ts)
      ? old
      : { ...reading, deviceId: event.deviceId, coldRoomId: event.coldRoomId },
  )

  const listedOffline = qc
    .getQueriesData<Paginated<Device>>({ queryKey: ['devices'] })
    .some(([, data]) => data?.items?.some((d) => d.id === event.deviceId && d.status === 'offline'))
  if (listedOffline) void qc.invalidateQueries({ queryKey: ['devices'] })
}

/**
 * Keeps every page live while signed in: joins the realtime room of each
 * warehouse the user can see and applies readings and alert changes to the
 * cache, so grids, device pages and the notification bell update as soon as
 * something happens instead of on their next poll (which stays as fallback).
 */
export function useLiveSync(enabled: boolean) {
  const qc = useQueryClient()
  const warehouses = useWarehouseLookup()
  const key = [...new Set(warehouses.items.map((w) => w.id))].sort().join()

  useEffect(() => {
    if (!enabled || !key) return
    const s = getSocket()
    let notificationsTimer: ReturnType<typeof setTimeout> | undefined

    const onReading = (event: ColdRoomReadingEvent) => applyReading(qc, event)
    const onAlertsChanged = () => {
      void qc.invalidateQueries({ queryKey: STATUS_KEY })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      clearTimeout(notificationsTimer)
      notificationsTimer = setTimeout(
        () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
        NOTIFICATIONS_DELAY_MS,
      )
    }

    s.on('coldroom:reading', onReading)
    s.on('alerts:changed', onAlertsChanged)
    const release = joinWarehouses(key.split(','))
    return () => {
      clearTimeout(notificationsTimer)
      s.off('coldroom:reading', onReading)
      s.off('alerts:changed', onAlertsChanged)
      release()
    }
  }, [enabled, key, qc])
}
