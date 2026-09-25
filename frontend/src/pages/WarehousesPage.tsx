import { alertsApi, coldRoomsApi, devicesApi, warehousesApi, type WarehouseQuery } from '@/api/endpoints'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { FilterDialog } from '@/components/common/FilterDialog'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { SearchInput } from '@/components/common/SearchInput'
import { StatGrid, StatTile } from '@/components/common/StatTile'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CreateWarehouseDialog } from '@/components/warehouses/CreateWarehouseDialog'
import { formatDate, formatNumber } from '@/lib/format'
import { useListParams } from '@/lib/useListParams'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Cpu, Siren, Thermometer, Warehouse } from 'lucide-react'

const FILTER_KEYS = ['createdFrom', 'createdTo', 'hasAddress'] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS: Filters = { createdFrom: '', createdTo: '', hasAddress: '' }
const ANY = 'any' // Radix Select can't hold an empty value.

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
      validate={(d) =>
        d.createdFrom && d.createdTo && d.createdFrom > d.createdTo
          ? '“Từ ngày” phải trước hoặc bằng “Đến ngày”.'
          : null
      }
    >
      {(draft, set) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="f-created-from">Tạo từ ngày</FieldLabel>
              <Input
                id="f-created-from"
                type="date"
                value={draft.createdFrom}
                max={draft.createdTo || undefined}
                onChange={(e) => set('createdFrom', e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="f-created-to">Đến ngày</FieldLabel>
              <Input
                id="f-created-to"
                type="date"
                value={draft.createdTo}
                min={draft.createdFrom || undefined}
                onChange={(e) => set('createdTo', e.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="f-has-address">Địa chỉ</FieldLabel>
            <Select
              value={draft.hasAddress || ANY}
              onValueChange={(v) => set('hasAddress', v === ANY ? '' : v)}
            >
              <SelectTrigger id="f-has-address" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Tất cả</SelectItem>
                <SelectItem value="yes">Đã có địa chỉ</SelectItem>
                <SelectItem value="no">Chưa có địa chỉ</SelectItem>
              </SelectContent>
            </Select>
          </Field>
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
    search: list.search || undefined,
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
    hasAddress: hasAddress ? hasAddress === 'yes' : undefined,
  }
  const query = useQuery({
    queryKey: ['warehouses', params],
    queryFn: () => warehousesApi.list(params),
    placeholderData: keepPreviousData,
  })

  const clearButton = (
    <Button variant="outline" onClick={list.clearAll}>
      Xoá tìm kiếm & bộ lọc
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Kho"
        description="Danh sách kho lạnh trong phạm vi của bạn."
        actions={isAdmin && <CreateWarehouseDialog />}
      />

      <WarehouseStats />

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <SearchInput
            value={list.search}
            onSearch={list.setSearch}
            label="Tìm kho"
            placeholder="Tìm theo mã, tên hoặc địa chỉ…"
            className="sm:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <WarehouseFilterDialog
              value={list.filters}
              activeCount={list.activeFilterCount}
              onApply={list.setFilters}
            />
            {list.isFiltered && (
              <Button variant="ghost" size="lg" onClick={list.clearAll}>
                Xoá lọc
              </Button>
            )}
          </div>
          {list.isFiltered && query.data && (
            <p className="text-muted-foreground tabular-nums sm:ml-auto" aria-live="polite">
              Tìm thấy {formatNumber(query.data.meta.total)} kho
            </p>
          )}
        </div>

        <CardContent className="px-0">
          {query.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : query.data.items.length === 0 ? (
            query.data.meta.total > 0 ? (
              <EmptyState
                title="Trang này không có dữ liệu"
                description={`Danh sách chỉ có ${formatNumber(query.data.meta.totalPages)} trang.`}
                action={
                  <Button variant="outline" onClick={() => list.setPage(1)}>
                    Về trang đầu
                  </Button>
                }
              />
            ) : list.isFiltered ? (
              <EmptyState
                title="Không tìm thấy kho phù hợp"
                description="Thử từ khoá khác hoặc bỏ bớt bộ lọc."
                action={clearButton}
              />
            ) : (
              <EmptyState
                title="Chưa có kho nào"
                description={
                  isAdmin
                    ? 'Tạo kho đầu tiên để bắt đầu quản lý phòng lạnh và thiết bị.'
                    : 'Bạn chưa được phân công vào kho nào. Liên hệ quản trị viên để được gán kho.'
                }
                action={isAdmin && <CreateWarehouseDialog />}
              />
            )
          ) : (
            <div aria-busy={query.isFetching}>
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
                  {query.data.items.map((w) => (
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
            </div>
          )}
          {query.data && <Pagination meta={query.data.meta} />}
        </CardContent>
      </Card>
    </>
  )
}
