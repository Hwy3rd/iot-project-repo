import { coldRoomsApi, devicesApi } from '@/api/endpoints'
import type { Device } from '@/api/types'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState } from '@/components/common/States'
import { ToneBadge } from '@/components/common/StatusBadge'
import { AlertStream } from '@/components/monitoring/AlertStream'
import { LiveBadge } from '@/components/monitoring/LiveBadge'
import { RoomDetailSheet } from '@/components/monitoring/RoomDetailSheet'
import { RoomTile } from '@/components/monitoring/RoomTile'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { useWarehouseLookup } from '@/lib/lookups'
import { TEMP_STATE, TEMP_STATE_ORDER, tempState, type TempState } from '@/lib/room-status'
import { patchParams } from '@/lib/useListParams'
import { useNow } from '@/lib/useNow'
import { usePreference } from '@/lib/usePreference'
import { useWarehouseLive } from '@/lib/useWarehouseLive'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useSearchParams } from 'react-router'

// A warehouse has a bounded number of rooms/devices; one page of 100 covers it.
const ALL = { limit: 100 } as const
// Readings/alerts arrive over the socket; these only cover what it doesn't
// push (device status) or a dropped connection.
const STATUS_FALLBACK_MS = 5 * 60_000
const DEVICES_REFRESH_MS = 60_000
// Re-evaluates "stale" (no sample for 10 min) while nothing new arrives.
const CLOCK_MS = 15_000

/**
 * Real-time board for one warehouse: every cold room's live reading and
 * device states, a collapsible alert stream, and a per-room detail panel
 * with a temperature chart. Warehouse and room live in the URL
 * (?warehouseId=…&room=…) so a view can be shared; the last warehouse is
 * remembered as the default.
 */
export function MonitoringPage() {
  const [params, setParams] = useSearchParams()
  const warehouses = useWarehouseLookup()
  const [savedWarehouse, setSavedWarehouse] = usePreference(
    'monitoring:warehouse',
    '',
    warehouses.items.map((w) => w.id),
  )
  const [panel, setPanel] = usePreference('monitoring:alerts', 'open', ['open', 'closed'] as const)
  const now = useNow(CLOCK_MS)

  const warehouseId =
    params.get('warehouseId') || savedWarehouse || warehouses.items[0]?.id || ''
  const roomId = params.get('room')
  const warehouse = warehouses.get(warehouseId)

  const selectWarehouse = (id: string) => {
    setSavedWarehouse(id)
    setParams((prev) => patchParams(prev, { warehouseId: id, room: null }))
  }
  const selectRoom = (id: string | null) =>
    setParams((prev) => patchParams(prev, { room: id }), { replace: !id })

  const rooms = useQuery({
    queryKey: ['cold-rooms', { warehouseId, ...ALL }],
    queryFn: () => coldRoomsApi.list({ warehouseId, ...ALL }),
    enabled: !!warehouseId,
  })
  const statuses = useQuery({
    queryKey: ['cold-rooms', 'status', { warehouseIds: [warehouseId] }],
    queryFn: () => coldRoomsApi.status({ warehouseIds: [warehouseId] }),
    enabled: !!warehouseId,
    refetchInterval: STATUS_FALLBACK_MS,
  })
  const devices = useQuery({
    queryKey: ['devices', { warehouseId, ...ALL }],
    queryFn: () => devicesApi.list({ warehouseId, ...ALL }),
    enabled: !!warehouseId,
    refetchInterval: DEVICES_REFRESH_MS,
  })
  const live = useWarehouseLive(warehouseId ? [warehouseId] : [], !!warehouseId)

  const statusByRoom = new Map((statuses.data ?? []).map((s) => [s.coldRoomId, s]))
  const devicesByRoom = new Map<string, Device[]>()
  for (const d of devices.data?.items ?? []) {
    if (!d.coldRoomId) continue
    devicesByRoom.set(d.coldRoomId, [...(devicesByRoom.get(d.coldRoomId) ?? []), d])
  }
  const roomList = rooms.data?.items ?? []
  const roomName = (id: string) => roomList.find((r) => r.id === id)?.name ?? 'Phòng lạnh'
  const selectedRoom = roomList.find((r) => r.id === roomId)

  const byState: Partial<Record<TempState, number>> = {}
  for (const r of roomList) {
    const s = tempState(statusByRoom.get(r.id)?.latest ?? null, now)
    byState[s] = (byState[s] ?? 0) + 1
  }

  if (warehouses.items.length === 0 && !warehouseId) {
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

  const panelOpen = panel === 'open'

  return (
    <>
      <PageHeader
        title="Giám sát trực tiếp"
        description="Nhiệt độ, thiết bị và cảnh báo của một kho, cập nhật theo thời gian thực."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <LiveBadge live={live} />
            <Select value={warehouseId} onValueChange={selectWarehouse}>
              <SelectTrigger aria-label="Chọn kho" className="w-72">
                <SelectValue placeholder="Chọn kho…" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {roomList.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-label="Tóm tắt trạng thái phòng">
              <span className="font-medium">{formatNumber(roomList.length)} phòng lạnh:</span>
              {TEMP_STATE_ORDER.filter((s) => byState[s]).map((s) => (
                <ToneBadge key={s} tone={TEMP_STATE[s].tone}>
                  {formatNumber(byState[s])} {TEMP_STATE[s].label.toLowerCase()}
                </ToneBadge>
              ))}
            </div>
          )}

          {rooms.isPending ? (
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
            <AlertStream warehouseId={warehouseId} roomName={roomName} onSelectRoom={selectRoom} />
          </Card>
        )}
      </div>

      <RoomDetailSheet
        room={selectedRoom}
        warehouseName={warehouse ? `${warehouse.name} (${warehouse.code})` : ''}
        status={selectedRoom ? statusByRoom.get(selectedRoom.id) : undefined}
        devices={selectedRoom ? (devicesByRoom.get(selectedRoom.id) ?? []) : []}
        now={now}
        onClose={() => selectRoom(null)}
      />
    </>
  )
}
