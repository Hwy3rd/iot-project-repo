import { devicesApi, type DeviceQuery } from '@/api/endpoints'
import type { Device, DeviceStatus } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateDeviceDialog, EditDeviceDialog } from '@/components/devices/DeviceFormDialog'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { LocationFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
import { PageHeader } from '@/components/common/PageHeader'
import { SelectAllHead, SelectRowCell } from '@/components/common/row-selection'
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
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { useRowSelection } from '@/lib/useRowSelection'
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
  const canDelete = isAdmin
  // PATCH /devices/:id is Admin or Technician (firmware version only).
  const canEdit = hasRole(user?.role, ['admin', 'technician'])
  const rows = useRowDialogs<Device>()
  const current = rows.item
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
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).map((d) => ({ id: d.id, name: d.uniqueId }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

  return (
    <>
      <PageHeader
        title="Thiết bị"
        description="Thiết bị IoT và vòng đời kỹ thuật."
        actions={isAdmin && <CreateDeviceDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="thiết bị"
        selection={{
          count: selection.count,
          offPageCount: selection.offPageCount,
          onClear: selection.clear,
          actions: (
            <BulkDeleteDialog
              ids={selection.ids}
              noun="thiết bị"
              bulkRemove={devicesApi.bulkRemove}
              invalidate={[['devices']]}
              onDone={selection.clear}
              describe={selection.nameOf}
            />
          ),
        }}
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
                {canDelete && (
                  <SelectAllHead selection={selection} label="Chọn tất cả thiết bị trên trang" />
                )}
                <TableHead className="pl-4">Mã thiết bị</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Phòng lạnh</TableHead>
                <TableHead>Firmware</TableHead>
                <TableHead>Tín hiệu cuối</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id} {...rowOpenProps(() => rows.view(d))}>
                  {canDelete && (
                    <SelectRowCell selection={selection} id={d.id} label={`Chọn thiết bị ${d.uniqueId}`} />
                  )}
                  <TableCell className="pl-4 font-mono text-sm" translate="no">
                    {d.uniqueId}
                  </TableCell>
                  <TableCell>
                    <DeviceStatusBadge status={d.status} />
                  </TableCell>
                  <TableCell>
                    {d.coldRoomId ? (
                      coldRooms.label(d.coldRoomId)
                    ) : (
                      <span className="text-muted-foreground">Chưa gán</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm" translate="no">
                    {d.firmwareVersion || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.lastHeartbeatAt ? (
                      <time dateTime={d.lastHeartbeatAt} title={formatDateTime(d.lastHeartbeatAt)}>
                        {formatRelative(d.lastHeartbeatAt)}
                      </time>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <RowActionsCell
                    label={`thiết bị ${d.uniqueId}`}
                    onView={() => rows.view(d)}
                    onEdit={canEdit ? () => rows.edit(d) : undefined}
                  />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>

      {current && (
        <>
          <DetailDialog
            open={rows.viewing}
            onClose={rows.close}
            title={<span className="font-mono" translate="no">{current.uniqueId}</span>}
            description={current.coldRoomId ? coldRooms.label(current.coldRoomId) : 'Chưa gán phòng lạnh'}
            onEdit={canEdit ? () => rows.edit(current) : undefined}
          >
            <DetailList
              fields={[
                {
                  label: 'Mã thiết bị',
                  value: <span className="font-mono" translate="no">{current.uniqueId}</span>,
                },
                { label: 'Trạng thái', value: <DeviceStatusBadge status={current.status} /> },
                {
                  label: 'Phòng lạnh',
                  value: current.coldRoomId ? coldRooms.label(current.coldRoomId) : 'Chưa gán',
                },
                {
                  label: 'Firmware',
                  value: current.firmwareVersion && (
                    <span className="font-mono" translate="no">{current.firmwareVersion}</span>
                  ),
                },
                { label: 'Tín hiệu cuối', value: formatDateTime(current.lastHeartbeatAt) },
                { label: 'Gán vào phòng lúc', value: formatDateTime(current.claimedAt) },
                { label: 'Mã claim hết hạn', value: formatDateTime(current.claimCodeExpiresAt) },
                { label: 'Ngừng sử dụng lúc', value: formatDateTime(current.decommissionedAt) },
                { label: 'Ngày đăng ký', value: formatDateTime(current.createdAt) },
                { label: 'Cập nhật lần cuối', value: formatDateTime(current.updatedAt) },
              ]}
            />
          </DetailDialog>
          {canEdit && (
            <EditDeviceDialog
              key={`${current.id}:${current.updatedAt}`}
              device={current}
              open={rows.editing}
              onClose={rows.close}
            />
          )}
        </>
      )}
    </>
  )
}
