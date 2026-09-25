import { coldRoomsApi, type ColdRoomQuery } from '@/api/endpoints'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateColdRoomDialog } from '@/components/cold-rooms/CreateColdRoomDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, rangeError } from '@/lib/filters'
import { formatDate, formatNumber, formatTemp } from '@/lib/format'
import { useWarehouseLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
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
  const list = useListParams(FILTER_KEYS)
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

  return (
    <>
      <PageHeader title="Phòng lạnh" description="Phòng lạnh và cấu hình ngưỡng nhiệt độ."
        actions={canCreate && <CreateColdRoomDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="phòng lạnh"
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
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Tên phòng</TableHead>
                <TableHead className="hidden md:table-cell">Kho</TableHead>
                <TableHead className="text-right">Ngưỡng nhiệt độ</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Sức chứa (pallet)</TableHead>
                <TableHead className="hidden pr-4 sm:table-cell">Ngày tạo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4 whitespace-normal">
                    <span className="font-medium">{r.name}</span>
                    <span className="mt-0.5 block text-muted-foreground md:hidden">
                      {warehouses.label(r.warehouseId)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {warehouses.label(r.warehouseId)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTemp(r.tempMin)} – {formatTemp(r.tempMax)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {formatNumber(r.capacityPallets)}
                  </TableCell>
                  <TableCell className="hidden pr-4 text-muted-foreground sm:table-cell">
                    <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>
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
