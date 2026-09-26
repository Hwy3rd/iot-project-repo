import type { WorkShiftStatus } from '@/api/types'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getSocket, holdSocket } from './socket'

// Server: USER_EVENTS.WORK_SHIFT_CHANGED in server/src/libs/constants/realtime.constant.ts.
// Sent to the Staff member concerned, the warehouse's Managers and every Admin.
export interface WorkShiftChangedEvent {
  workShiftId: string
  warehouseId: string
  staffId: string
  status: WorkShiftStatus
  /** Minutes the check-in came after the shift start (0 = on time). */
  lateMinutes: number | null
}

/**
 * While `enabled`, refetches every work-shift query (the lists and the
 * caller's own attendance, all under ['work-shifts']) when an attendance
 * request changes, then calls `onEvent` for anything extra (a toast).
 */
export function useWorkShiftEvents(
  enabled: boolean,
  onEvent?: (event: WorkShiftChangedEvent) => void,
) {
  const qc = useQueryClient()
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    if (!enabled) return
    const s = getSocket()
    const handler = (event: WorkShiftChangedEvent) => {
      void qc.invalidateQueries({ queryKey: ['work-shifts'] })
      onEventRef.current?.(event)
    }
    s.on('workshift:changed', handler)
    const release = holdSocket()
    return () => {
      s.off('workshift:changed', handler)
      release()
    }
  }, [enabled, qc])
}
