import { coldRoomsApi, type ColdRoomQuery } from '@/api/endpoints'
import type { ColdRoom } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateColdRoomDialog, EditColdRoomDialog } from '@/components/cold-rooms/ColdRoomFormDialog'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
import { PageHeader } from '@/components/common/PageHeader'
import { LastUpdated } from '@/components/common/LastUpdated'
import { ViewToggle } from '@/components/common/ViewToggle'
import { ColdRoomGrid } from '@/components/cold-rooms/ColdRoomGrid'
import { SelectAllHead, SelectRowCell } from '@/components/common/row-selection'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, rangeError } from '@/lib/filters'
import { formatDate, formatDateTime, formatNumber, formatTemp } from '@/lib/format'
import { useWarehouseLookup } from '@/lib/lookups'
import { STATUS_REFRESH_MS } from '@/lib/room-status'
import { param, useListParams } from '@/lib/useListParams'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { useRowSelection } from '@/lib/useRowSelection'
import { useViewMode } from '@/lib/useViewMode'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = ['warehouseId', 'createdFrom', 'createdTo'] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function ColdRoomFilterDialog({
  value,
  activeCount,
  onApply,
}: {
  value: Filters
  activeCount: number
  onApply: (next: Filters) => void
}) {
  const warehouses = useWarehouseLookup()
  return (
    <FilterDialog
      value={value}
      emptyValue={NO_FILTERS}
      activeCount={activeCount}
      onApply={onApply}
      description="Thu hẹp phòng lạnh theo kho và ngày tạo."
      validate={(d) => rangeError([d.createdFrom, d.createdTo, 'Ngày tạo'])}
    >
      {(draft, set) => (
        <>
          <SelectFilter
            id="f-warehouse"
            label="Kho"
            value={draft.warehouseId}
            options={warehouses.options}
            onChange={(v) => set('warehouseId', v)}
          />
          <DateRangeFilter
            id="f-created"
            fromLabel="Tạo từ ngày"
            from={draft.createdFrom}
            to={draft.createdTo}
            onFromChange={(v) => set('createdFrom', v)}
            onToChange={(v) => set('createdTo', v)}
          />
        </>
      )}
    </FilterDialog>
  )
}

export function ColdRoomsPage() {
  const { user } = useAuth()
  const canCreate = hasRole(user?.role, ['admin', 'manager'])
  const canDelete = hasRole(user?.role, ['admin'])
  // Manager scope is checked per room by the backend.
  const canEdit = canCreate
  const rows = useRowDialogs<ColdRoom>()
  const current = rows.item
  const list = useListParams(FILTER_KEYS)
  const [view, setView] = useViewMode('cold-rooms')
  const f = list.filters
  const warehouses = useWarehouseLookup()

  const params: ColdRoomQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    warehouseId: param(f.warehouseId),
    createdFrom: param(f.createdFrom),
    createdTo: param(f.createdTo),
  }
  const query = useQuery({
    queryKey: ['cold-rooms', params],
    queryFn: () => coldRoomsApi.list(params),
    placeholderData: keepPreviousData,
  })
  // Room status only matters (and is only polled) in the grid.
  const pageRoomIds = (query.data?.items ?? []).map((r) => r.id)
  const status = useQuery({
    queryKey: ['cold-rooms', 'status', { coldRoomIds: pageRoomIds }],
    queryFn: () => coldRoomsApi.status({ coldRoomIds: pageRoomIds }),
    enabled: view === 'grid' && pageRoomIds.length > 0,
    refetchInterval: STATUS_REFRESH_MS,
  })
  const statuses = new Map((status.data ?? []).map((s) => [s.coldRoomId, s]))
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).map((r) => ({ id: r.id, name: r.name }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

  return (
    <>
      <PageHeader
        title="Phòng lạnh"
        description="Phòng lạnh và cấu hình ngưỡng nhiệt độ."
        actions={canCreate && <CreateColdRoomDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="phòng lạnh"
        toolbarEnd={
          <>
            {view === 'grid' && (
              <LastUpdated
                at={status.dataUpdatedAt}
                fetching={status.isFetching}
                everySeconds={STATUS_REFRESH_MS / 1000}
              />
            )}
            <ViewToggle value={view} onChange={setView} />
          </>
        }
        selection={{
          count: selection.count,
          offPageCount: selection.offPageCount,
          onClear: selection.clear,
          actions: (
            <BulkDeleteDialog
              ids={selection.ids}
              noun="phòng lạnh"
              bulkRemove={coldRoomsApi.bulkRemove}
              invalidate={[['cold-rooms']]}
              onDone={selection.clear}
              describe={selection.nameOf}
            />
          ),
        }}
        search={{ label: 'Tìm phòng lạnh', placeholder: 'Tìm theo tên phòng lạnh…' }}
        filters={
          <ColdRoomFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
          />
        }
        empty={{
          title: 'Chưa có phòng lạnh nào',
          description: 'Các kho trong phạm vi của bạn chưa có phòng lạnh.',
          action: canCreate && <CreateColdRoomDialog />,
        }}
      >
        {(items) =>
          view === 'grid' ? (
            <ColdRoomGrid
              rooms={items}
              statuses={statuses}
              statusPending={status.isPending}
              statusError={status.isError}
              warehouseLabel={warehouses.label}
              selection={canDelete ? selection : undefined}
              onView={rows.view}
              onEdit={canEdit ? rows.edit : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {canDelete && (
                    <SelectAllHead selection={selection} label="Chọn tất cả phòng lạnh trên trang" />
                  )}
                  <TableHead className="pl-4">Tên phòng</TableHead>
                  <TableHead>Kho</TableHead>
                  <TableHead className="text-right">Ngưỡng nhiệt độ</TableHead>
                  <TableHead className="text-right">Sức chứa (pallet)</TableHead>
                  <TableHead>Ngày tạo</TableHead>
                  <RowActionsHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id} {...rowOpenProps(() => rows.view(r))}>
                    {canDelete && (
                      <SelectRowCell selection={selection} id={r.id} label={`Chọn phòng lạnh ${r.name}`} />
                    )}
                    <TableCell className="pl-4 min-w-48 whitespace-normal">
                      <span className="font-medium">{r.name}</span>
                    </TableCell>
                    <TableCell>
                      {warehouses.label(r.warehouseId)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTemp(r.tempMin)} – {formatTemp(r.tempMax)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(r.capacityPallets)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>
                    </TableCell>
                    <RowActionsCell
                      label={`phòng lạnh ${r.name}`}
                      onView={() => rows.view(r)}
                      onEdit={canEdit ? () => rows.edit(r) : undefined}
                    />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </ListCard>

      {current && (
        <>
          <DetailDialog
            open={rows.viewing}
            onClose={rows.close}
            title={current.name}
            description={warehouses.label(current.warehouseId)}
            onEdit={canEdit ? () => rows.edit(current) : undefined}
          >
            <DetailList
              fields={[
                { label: 'Tên phòng', value: current.name },
                { label: 'Kho', value: warehouses.label(current.warehouseId) },
                {
                  label: 'Ngưỡng nhiệt độ',
                  value: `${formatTemp(current.tempMin)} – ${formatTemp(current.tempMax)}`,
                },
                { label: 'Độ trễ', value: formatTemp(current.hysteresis) },
                { label: 'Cửa mở tối đa', value: `${formatNumber(current.doorOpenMaxSeconds)} giây` },
                { label: 'Sức chứa (pallet)', value: formatNumber(current.capacityPallets) },
                {
                  label: 'Tải trọng',
                  value: current.capacityWeightKg === null ? null : `${formatNumber(current.capacityWeightKg)} kg`,
                },
                {
                  label: 'Thể tích',
                  value: current.capacityVolumeM3 === null ? null : `${formatNumber(current.capacityVolumeM3)} m³`,
                },
                { label: 'Ngày tạo', value: formatDateTime(current.createdAt) },
                { label: 'Cập nhật lần cuối', value: formatDateTime(current.updatedAt) },
              ]}
            />
          </DetailDialog>
          {canEdit && (
            <EditColdRoomDialog
              key={`${current.id}:${current.updatedAt}`}
              room={current}
              open={rows.editing}
              onClose={rows.close}
            />
          )}
        </>
      )}
    </>
  )
}
