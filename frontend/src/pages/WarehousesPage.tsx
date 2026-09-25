import { alertsApi, coldRoomsApi, devicesApi, warehousesApi, type WarehouseQuery } from '@/api/endpoints'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
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
import { param, useListParams } from '@/lib/useListParams'
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
  const list = useListParams(FILTER_KEYS)
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
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Mã</TableHead>
                <TableHead>Tên kho</TableHead>
                <TableHead className="hidden md:table-cell">Địa chỉ</TableHead>
                <TableHead className="hidden pr-4 sm:table-cell">Ngày tạo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="pl-4 align-top font-mono text-xs whitespace-normal break-all sm:whitespace-nowrap sm:break-normal" translate="no">
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
        )}
      </ListCard>
    </>
  )
}
