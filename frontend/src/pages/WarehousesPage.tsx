import { alertsApi, coldRoomsApi, devicesApi, warehousesApi, type WarehouseQuery } from '@/api/endpoints'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import { LastUpdated } from '@/components/common/LastUpdated'
import { ViewToggle } from '@/components/common/ViewToggle'
import { WarehouseGrid } from '@/components/warehouses/WarehouseGrid'
import { SelectAllHead, SelectRowCell } from '@/components/common/row-selection'
import { StatGrid, StatTile } from '@/components/common/StatTile'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CreateWarehouseDialog } from '@/components/warehouses/CreateWarehouseDialog'
import { rangeError } from '@/lib/filters'
import { formatDate } from '@/lib/format'
import { STATUS_REFRESH_MS } from '@/lib/room-status'
import { param, useListParams } from '@/lib/useListParams'
import { useRowSelection } from '@/lib/useRowSelection'
import { useViewMode } from '@/lib/useViewMode'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Cpu, Siren, Thermometer, Warehouse } from 'lucide-react'

const FILTER_KEYS = ['createdFrom', 'createdTo', 'hasAddress'] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS: Filters = { createdFrom: '', createdTo: '', hasAddress: '' }

// Only `total` is needed for the tiles, so ask for a single row.
const COUNT = { limit: 1 } as const

function WarehouseStats() {
  const warehouses = useQuery({
    queryKey: ['warehouses', COUNT],
    queryFn: () => warehousesApi.list(COUNT),
  })
  const coldRooms = useQuery({
    queryKey: ['cold-rooms', COUNT],
    queryFn: () => coldRoomsApi.list(COUNT),
  })
  const devices = useQuery({ queryKey: ['devices', COUNT], queryFn: () => devicesApi.list(COUNT) })
  const openAlerts = useQuery({
    queryKey: ['alerts', { status: 'open', ...COUNT }],
    queryFn: () => alertsApi.list({ status: 'open', ...COUNT }),
  })

  return (
    <StatGrid>
      <StatTile label="Tổng số kho" value={warehouses.data?.meta.total} icon={Warehouse} />
      <StatTile
        label="Phòng lạnh"
        value={coldRooms.data?.meta.total}
        icon={Thermometer}
        to="/cold-rooms"
      />
      <StatTile label="Thiết bị" value={devices.data?.meta.total} icon={Cpu} to="/devices" />
      <StatTile
        label="Cảnh báo đang mở"
        value={openAlerts.data?.meta.total}
        icon={Siren}
        to="/alerts?status=open"
        tone="text-destructive bg-destructive/10"
      />
    </StatGrid>
  )
}

function WarehouseFilterDialog({
  value,
  activeCount,
  onApply,
}: {
  value: Filters
  activeCount: number
  onApply: (next: Filters) => void
}) {
  return (
    <FilterDialog
      value={value}
      emptyValue={NO_FILTERS}
      activeCount={activeCount}
      onApply={onApply}
      description="Thu hẹp danh sách kho theo ngày tạo và địa chỉ."
      validate={(d) => rangeError([d.createdFrom, d.createdTo, 'Ngày tạo'])}
    >
      {(draft, set) => (
        <>
          <DateRangeFilter
            id="f-created"
            fromLabel="Tạo từ ngày"
            from={draft.createdFrom}
            to={draft.createdTo}
            onFromChange={(v) => set('createdFrom', v)}
            onToChange={(v) => set('createdTo', v)}
          />
          <SelectFilter
            id="f-has-address"
            label="Địa chỉ"
            value={draft.hasAddress}
            onChange={(v) => set('hasAddress', v)}
            options={[
              { value: 'yes', label: 'Đã có địa chỉ' },
              { value: 'no', label: 'Chưa có địa chỉ' },
            ]}
          />
        </>
      )}
    </FilterDialog>
  )
}

/** Management list: stats, URL-driven search/filter/pagination and a create dialog. */
export function WarehousesPage() {
  const { user } = useAuth()
  const isAdmin = hasRole(user?.role, ['admin'])
  const canDelete = isAdmin
  const list = useListParams(FILTER_KEYS)
  const [view, setView] = useViewMode('warehouses')
  const { createdFrom, createdTo, hasAddress } = list.filters

  const params: WarehouseQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    createdFrom: param(createdFrom),
    createdTo: param(createdTo),
    hasAddress: hasAddress ? hasAddress === 'yes' : undefined,
  }
  const query = useQuery({
    queryKey: ['warehouses', params],
    queryFn: () => warehousesApi.list(params),
    placeholderData: keepPreviousData,
  })
  // Room status only matters (and is only polled) in the grid.
  const pageWarehouseIds = (query.data?.items ?? []).map((w) => w.id)
  const status = useQuery({
    queryKey: ['cold-rooms', 'status', { warehouseIds: pageWarehouseIds }],
    queryFn: () => coldRoomsApi.status({ warehouseIds: pageWarehouseIds }),
    enabled: view === 'grid' && pageWarehouseIds.length > 0,
    refetchInterval: STATUS_REFRESH_MS,
  })
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).map((w) => ({ id: w.id, name: `${w.code} · ${w.name}` }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

  return (
    <>
      <PageHeader
        title="Kho"
        description="Danh sách kho lạnh trong phạm vi của bạn."
        actions={isAdmin && <CreateWarehouseDialog />}
      />

      <WarehouseStats />

      <ListCard
        list={list}
        query={query}
        noun="kho"
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
              noun="kho"
              bulkRemove={warehousesApi.bulkRemove}
              invalidate={[['warehouses'], ['cold-rooms']]}
              onDone={selection.clear}
              warning={
                <>Các <strong>phòng lạnh</strong> và <strong>phân công nhân sự</strong> thuộc những kho này cũng bị xoá theo.</>
              }
              describe={selection.nameOf}
            />
          ),
        }}
        search={{ label: 'Tìm kho', placeholder: 'Tìm theo mã, tên hoặc địa chỉ…' }}
        filters={
          <WarehouseFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
          />
        }
        empty={{
          title: 'Chưa có kho nào',
          description: isAdmin
            ? 'Tạo kho đầu tiên để bắt đầu quản lý phòng lạnh và thiết bị.'
            : 'Bạn chưa được phân công vào kho nào. Liên hệ quản trị viên để được gán kho.',
          action: isAdmin && <CreateWarehouseDialog />,
        }}
      >
        {(items) =>
          view === 'grid' ? (
            <WarehouseGrid
              warehouses={items}
              statuses={status.data ?? []}
              statusPending={status.isPending}
              statusError={status.isError}
              selection={canDelete ? selection : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {canDelete && (
                    <SelectAllHead selection={selection} label="Chọn tất cả kho trên trang" />
                  )}
                  <TableHead className="pl-4">Mã</TableHead>
                  <TableHead>Tên kho</TableHead>
                  <TableHead className="hidden md:table-cell">Địa chỉ</TableHead>
                  <TableHead className="hidden pr-4 sm:table-cell">Ngày tạo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((w) => (
                  <TableRow key={w.id}>
                    {canDelete && (
                      <SelectRowCell selection={selection} id={w.id} label={`Chọn kho ${w.code}`} />
                    )}
                    <TableCell className="pl-4 align-top font-mono text-sm whitespace-normal break-all sm:whitespace-nowrap sm:break-normal" translate="no">
                      {w.code}
                    </TableCell>
                    <TableCell className="min-w-40 whitespace-normal break-words">
                      <span className="font-medium">{w.name}</span>
                      {/* Address column is hidden on small screens; show it inline instead. */}
                      {w.address && (
                        <span className="mt-0.5 line-clamp-2 text-muted-foreground md:hidden">
                          {w.address}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-md whitespace-normal text-muted-foreground md:table-cell">
                      <span className="line-clamp-2">{w.address || '—'}</span>
                    </TableCell>
                    <TableCell className="hidden pr-4 text-muted-foreground sm:table-cell">
                      <time dateTime={w.createdAt}>{formatDate(w.createdAt)}</time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </ListCard>
    </>
  )
}
