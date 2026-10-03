import { coldRoomsApi, devicesApi } from '@/api/endpoints'
import type { Device } from '@/api/types'
import { PageHeader } from '@/components/common/PageHeader'
import { PickWarehouse } from '@/components/common/PickWarehouse'
import { EmptyState, ErrorState } from '@/components/common/States'
import { ToneBadge } from '@/components/common/StatusBadge'
import { AlertStream } from '@/components/monitoring/AlertStream'
import { LiveBadge } from '@/components/monitoring/LiveBadge'
import { RoomFocus } from '@/components/monitoring/RoomFocus'
import { RoomSwitcher } from '@/components/monitoring/RoomSwitcher'
import { RoomTile } from '@/components/monitoring/RoomTile'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { TEMP_STATE, TEMP_STATE_ORDER, tempState, type TempState } from '@/lib/room-status'
import { patchParams } from '@/lib/useListParams'
import { useNow } from '@/lib/useNow'
import { useCurrentWarehouse } from '@/lib/useCurrentWarehouse'
import { usePreference } from '@/lib/usePreference'
import { useWarehouseLive } from '@/lib/useWarehouseLive'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

// A warehouse has a bounded number of rooms/devices; one page of 100 covers it.
const ALL = { limit: 100 } as const
// Readings/alerts arrive over the socket; these only cover what it doesn't
// push (device status) or a dropped connection — in which case readings are
// polled often enough to stay current (devices report every few seconds).
const STATUS_FALLBACK_MS = 5 * 60_000
const STATUS_OFFLINE_MS = 10_000
const DEVICES_REFRESH_MS = 60_000
// Re-evaluates "stale" (no sample for 10 min) while nothing new arrives.
const CLOCK_MS = 15_000

/**
 * Real-time board for one warehouse, in two modes sharing the alert column:
 * - the board: every cold room's live reading and device states;
 * - one room open (?room=…, so Back works): its details and controls take
 *   the board's place, with a compact strip of all rooms on top to keep an
 *   eye on the rest and switch in one click.
 * The warehouse is the header's current one.
 */
export function MonitoringPage() {
  const [params, setParams] = useSearchParams()
  const { warehouseId, warehouse, warehouses } = useCurrentWarehouse()
  const [panel, setPanel] = usePreference('monitoring:alerts', 'open', ['open', 'closed'] as const)
  const now = useNow(CLOCK_MS)

  const roomId = params.get('room')
  const selectRoom = (id: string | null) =>
    setParams((prev) => patchParams(prev, { room: id }), { replace: !id })

  const rooms = useQuery({
    queryKey: ['cold-rooms', { warehouseId, ...ALL }],
    queryFn: () => coldRoomsApi.list({ warehouseId, ...ALL }),
    enabled: !!warehouseId,
  })
  const live = useWarehouseLive(warehouseId ? [warehouseId] : [], !!warehouseId)
  const statuses = useQuery({
    queryKey: ['cold-rooms', 'status', { warehouseIds: [warehouseId] }],
    queryFn: () => coldRoomsApi.status({ warehouseIds: [warehouseId] }),
    enabled: !!warehouseId,
    refetchInterval: live ? STATUS_FALLBACK_MS : STATUS_OFFLINE_MS,
  })
  const devices = useQuery({
    queryKey: ['devices', { warehouseId, ...ALL }],
    queryFn: () => devicesApi.list({ warehouseId, ...ALL }),
    enabled: !!warehouseId,
    refetchInterval: DEVICES_REFRESH_MS,
  })
  const statusByRoom = new Map((statuses.data ?? []).map((s) => [s.coldRoomId, s]))
  const devicesByRoom = new Map<string, Device[]>()
  for (const d of devices.data?.items ?? []) {
    if (!d.coldRoomId) continue
    devicesByRoom.set(d.coldRoomId, [...(devicesByRoom.get(d.coldRoomId) ?? []), d])
  }
  const roomList = rooms.data?.items ?? []
  const roomName = (id: string) => roomList.find((r) => r.id === id)?.name ?? 'Phòng lạnh'
  const selectedRoom = roomList.find((r) => r.id === roomId)

  // Opening a room from far down the board: bring its details into view.
  // Switching between rooms keeps the position (the strip is at the top),
  // and so does landing on a ?room= link (nothing to scroll past yet).
  const topRef = useRef<HTMLDivElement>(null)
  const hadRoom = useRef(!!roomId)
  // Keyed on the URL, not on the loaded room: while the rooms load the room
  // is briefly unknown, which must not count as "came from the board".
  useEffect(() => {
    if (roomId && !hadRoom.current) topRef.current?.scrollIntoView({ block: 'start' })
    hadRoom.current = !!roomId
  }, [roomId])

  const byState: Partial<Record<TempState, number>> = {}
  for (const r of roomList) {
    const s = tempState(statusByRoom.get(r.id)?.latest ?? null, now)
    byState[s] = (byState[s] ?? 0) + 1
  }

  if (warehouses.settled && warehouses.items.length === 0) {
    return (
      <>
        <PageHeader title="Giám sát trực tiếp" />
        <Card>
          <EmptyState
            title="Chưa có kho nào để giám sát"
            description="Bạn cần được phân công vào ít nhất một kho."
          />
        </Card>
      </>
    )
  }

  if (!warehouseId) {
    return (
      <>
        <PageHeader title="Giám sát trực tiếp" />
        {warehouses.settled && (
          <PickWarehouse description="Màn giám sát hiển thị từng kho một. Kho bạn chọn cũng áp dụng cho các màn khác." />
        )}
      </>
    )
  }

  const panelOpen = panel === 'open'

  return (
    <>
      <PageHeader
        title="Giám sát trực tiếp"
        description="Nhiệt độ, thiết bị và cảnh báo của một kho, cập nhật theo thời gian thực."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <LiveBadge live={live} />
            <Button
              variant="outline"
              size="lg"
              aria-pressed={panelOpen}
              onClick={() => setPanel(panelOpen ? 'closed' : 'open')}
            >
              {panelOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
              {panelOpen ? 'Ẩn cảnh báo' : 'Hiện cảnh báo'}
            </Button>
          </div>
        }
      />

      <div ref={topRef} className="flex scroll-mt-4 flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {roomList.length > 0 && !selectedRoom && (
            <div className="flex flex-wrap items-center gap-2" aria-label="Tóm tắt trạng thái phòng">
              <span className="font-medium">{formatNumber(roomList.length)} phòng lạnh:</span>
              {TEMP_STATE_ORDER.filter((s) => byState[s]).map((s) => (
                <ToneBadge key={s} tone={TEMP_STATE[s].tone}>
                  {formatNumber(byState[s])} {TEMP_STATE[s].label.toLowerCase()}
                </ToneBadge>
              ))}
            </div>
          )}

          {selectedRoom ? (
            <>
              <RoomSwitcher
                rooms={roomList}
                statusByRoom={statusByRoom}
                selectedId={selectedRoom.id}
                now={now}
                onSelect={selectRoom}
                onShowAll={() => selectRoom(null)}
              />
              <RoomFocus
                key={selectedRoom.id}
                room={selectedRoom}
                warehouseName={warehouse ? `${warehouse.name} (${warehouse.code})` : ''}
                status={statusByRoom.get(selectedRoom.id)}
                devices={devicesByRoom.get(selectedRoom.id) ?? []}
                now={now}
              />
            </>
          ) : rooms.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-64 rounded-xl" />
              ))}
            </div>
          ) : rooms.isError ? (
            <Card>
              <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} />
            </Card>
          ) : roomList.length === 0 ? (
            <Card>
              <EmptyState title="Kho này chưa có phòng lạnh" />
            </Card>
          ) : (
            <div
              className={cn(
                'grid gap-4 sm:grid-cols-2',
                panelOpen ? '2xl:grid-cols-3' : 'xl:grid-cols-3 2xl:grid-cols-4',
              )}
            >
              {roomList.map((room) => (
                <RoomTile
                  key={room.id}
                  room={room}
                  status={statusByRoom.get(room.id)}
                  devices={devicesByRoom.get(room.id) ?? []}
                  now={now}
                  selected={room.id === roomId}
                  onSelect={() => selectRoom(room.id)}
                />
              ))}
            </div>
          )}
        </div>

        {panelOpen && warehouseId && (
          <Card className="h-[28rem] gap-0 overflow-hidden py-0 shadow-sm lg:sticky lg:top-4 lg:h-[calc(100dvh-8rem)] lg:w-96 lg:shrink-0">
            <AlertStream
              warehouseId={warehouseId}
              roomName={roomName}
              onSelectRoom={selectRoom}
              focusRoomId={selectedRoom?.id}
            />
          </Card>
        )}
      </div>
    </>
  )
}
