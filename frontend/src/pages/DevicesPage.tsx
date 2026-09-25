import { devicesApi, type DeviceQuery } from '@/api/endpoints'
import type { DeviceStatus } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateDeviceDialog } from '@/components/devices/CreateDeviceDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { LocationFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import { DeviceStatusBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, labelOptions } from '@/lib/filters'
import { formatDateTime, formatRelative } from '@/lib/format'
import { DEVICE_STATUS_LABEL } from '@/lib/labels'
import { useColdRoomLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = ['status', 'warehouseId', 'coldRoomId', 'unassigned'] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function DeviceFilterDialog({
  value,
  activeCount,
  onApply,
  canSeeUnassigned,
}: {
  value: Filters
  activeCount: number
  onApply: (next: Filters) => void
  canSeeUnassigned: boolean
}) {
  return (
    <FilterDialog
      value={value}
      emptyValue={NO_FILTERS}
      activeCount={activeCount}
      onApply={onApply}
      description="Thu hẹp thiết bị theo trạng thái và vị trí lắp đặt."
    >
      {(draft, set, patch) => (
        <>
          <SelectFilter
            id="f-status"
            label="Trạng thái"
            value={draft.status}
            options={labelOptions(DEVICE_STATUS_LABEL)}
            onChange={(v) => set('status', v)}
          />
          {/* An unclaimed device has no location, so the two are exclusive. */}
          {canSeeUnassigned && (
            <SelectFilter
              id="f-unassigned"
              label="Gán phòng lạnh"
              value={draft.unassigned}
              anyLabel="Tất cả thiết bị"
              options={[{ value: 'true', label: 'Chưa gán phòng lạnh nào' }]}
              onChange={(v) =>
                patch(v ? { unassigned: v, warehouseId: '', coldRoomId: '' } : { unassigned: '' })
              }
            />
          )}
          {!draft.unassigned && (
            <LocationFilter
              warehouseId={draft.warehouseId}
              coldRoomId={draft.coldRoomId}
              onChange={patch}
            />
          )}
        </>
      )}
    </FilterDialog>
  )
}

export function DevicesPage() {
  const { user } = useAuth()
  // Registering devices and seeing unclaimed ones are Admin-only (docs/RBAC.md).
  const isAdmin = hasRole(user?.role, ['admin'])
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const coldRooms = useColdRoomLookup()

  const params: DeviceQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    status: param(f.status) as DeviceStatus | undefined,
    warehouseId: param(f.warehouseId),
    coldRoomId: param(f.coldRoomId),
    unassigned: f.unassigned === 'true' || undefined,
  }
  const query = useQuery({
    queryKey: ['devices', params],
    queryFn: () => devicesApi.list(params),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Thiết bị" description="Thiết bị IoT và vòng đời kỹ thuật."
        actions={isAdmin && <CreateDeviceDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="thiết bị"
        search={{ label: 'Tìm thiết bị', placeholder: 'Tìm theo mã thiết bị hoặc firmware…' }}
        filters={
          <DeviceFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
            canSeeUnassigned={isAdmin}
          />
        }
        empty={{
          title: 'Chưa có thiết bị nào',
          description: 'Chưa có thiết bị nào được lắp vào phòng lạnh trong phạm vi của bạn.',
          action: isAdmin && <CreateDeviceDialog />,
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Mã thiết bị</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="hidden md:table-cell">Phòng lạnh</TableHead>
                <TableHead className="hidden lg:table-cell">Firmware</TableHead>
                <TableHead className="hidden pr-4 sm:table-cell">Tín hiệu cuối</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-4 font-mono text-xs break-all whitespace-normal" translate="no">
                    {d.uniqueId}
                  </TableCell>
                  <TableCell>
                    <DeviceStatusBadge status={d.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {d.coldRoomId ? (
                      coldRooms.label(d.coldRoomId)
                    ) : (
                      <span className="text-muted-foreground">Chưa gán</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs lg:table-cell" translate="no">
                    {d.firmwareVersion || '—'}
                  </TableCell>
                  <TableCell className="hidden pr-4 text-muted-foreground sm:table-cell">
                    {d.lastHeartbeatAt ? (
                      <time dateTime={d.lastHeartbeatAt} title={formatDateTime(d.lastHeartbeatAt)}>
                        {formatRelative(d.lastHeartbeatAt)}
                      </time>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>
    </>
  )
}
