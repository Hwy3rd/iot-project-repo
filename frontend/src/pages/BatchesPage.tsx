import { batchesApi, type BatchQuery } from '@/api/endpoints'
import type { BatchStatus } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateBatchDialog } from '@/components/batches/CreateBatchDialog'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, LocationFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import { SelectAllHead, SelectRowCell } from '@/components/common/row-selection'
import { BatchStatusBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, labelOptions, rangeError } from '@/lib/filters'
import { formatDate, formatNumber } from '@/lib/format'
import { BATCH_STATUS_LABEL, PRODUCT_UNIT_LABEL } from '@/lib/labels'
import { useColdRoomLookup, useProductTypeLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
import { useRowSelection } from '@/lib/useRowSelection'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = [
  'status',
  'warehouseId',
  'coldRoomId',
  'productTypeId',
  'expiryFrom',
  'expiryTo',
  'receivedFrom',
  'receivedTo',
] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function BatchFilterDialog({
  value,
  activeCount,
  onApply,
}: {
  value: Filters
  activeCount: number
  onApply: (next: Filters) => void
}) {
  const productTypes = useProductTypeLookup()
  return (
    <FilterDialog
      value={value}
      emptyValue={NO_FILTERS}
      activeCount={activeCount}
      onApply={onApply}
      description="Thu hẹp lô hàng theo trạng thái, vị trí, loại sản phẩm, hạn sử dụng và ngày nhập."
      validate={(d) =>
        rangeError(
          [d.expiryFrom, d.expiryTo, 'Hạn sử dụng'],
          [d.receivedFrom, d.receivedTo, 'Ngày nhập'],
        )
      }
    >
      {(draft, set, patch) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectFilter
              id="f-status"
              label="Trạng thái"
              value={draft.status}
              options={labelOptions(BATCH_STATUS_LABEL)}
              onChange={(v) => set('status', v)}
            />
            <SelectFilter
              id="f-product-type"
              label="Loại sản phẩm"
              value={draft.productTypeId}
              options={productTypes.options}
              onChange={(v) => set('productTypeId', v)}
            />
          </div>
          <LocationFilter
            warehouseId={draft.warehouseId}
            coldRoomId={draft.coldRoomId}
            onChange={patch}
          />
          <DateRangeFilter
            id="f-expiry"
            fromLabel="Hết hạn từ ngày"
            from={draft.expiryFrom}
            to={draft.expiryTo}
            onFromChange={(v) => set('expiryFrom', v)}
            onToChange={(v) => set('expiryTo', v)}
          />
          <DateRangeFilter
            id="f-received"
            fromLabel="Nhập từ ngày"
            from={draft.receivedFrom}
            to={draft.receivedTo}
            onFromChange={(v) => set('receivedFrom', v)}
            onToChange={(v) => set('receivedTo', v)}
          />
        </>
      )}
    </FilterDialog>
  )
}

export function BatchesPage() {
  const { user } = useAuth()
  const canCreate = hasRole(user?.role, ['admin', 'manager', 'staff'])
  const canDelete = hasRole(user?.role, ['admin', 'manager', 'staff'])
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const coldRooms = useColdRoomLookup()
  const productTypes = useProductTypeLookup()

  const params: BatchQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    status: param(f.status) as BatchStatus | undefined,
    warehouseId: param(f.warehouseId),
    coldRoomId: param(f.coldRoomId),
    productTypeId: param(f.productTypeId),
    expiryFrom: param(f.expiryFrom),
    expiryTo: param(f.expiryTo),
    receivedFrom: param(f.receivedFrom),
    receivedTo: param(f.receivedTo),
  }
  const query = useQuery({
    queryKey: ['batches', params],
    queryFn: () => batchesApi.list(params),
    placeholderData: keepPreviousData,
  })
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).filter((b) => b.status !== 'removed').map((b) => ({ id: b.id, name: b.batchCode }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

  return (
    <>
      <PageHeader
        title="Lô hàng"
        description="Nhập/xuất và theo dõi hạn sử dụng lô hàng."
        actions={canCreate && <CreateBatchDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="lô hàng"
        selection={{
          count: selection.count,
          offPageCount: selection.offPageCount,
          onClear: selection.clear,
          actions: (
            <BulkDeleteDialog
              ids={selection.ids}
              noun="lô hàng"
              bulkRemove={batchesApi.bulkRemove}
              invalidate={[['batches']]}
              onDone={selection.clear}
              verb="Xuất kho"
              failureText={{ 409: 'lô đã được xuất trước đó' }}
              warning={
                <>Lô hàng không bị xoá khỏi hệ thống mà chuyển sang trạng thái <strong>Đã xuất</strong>. Lô đã xuất không chọn được. Nhân viên chỉ thao tác được khi đang trong ca trực tại kho.</>
              }
              describe={selection.nameOf}
            />
          ),
        }}
        search={{ label: 'Tìm lô hàng', placeholder: 'Tìm theo mã lô hoặc nhà cung cấp…' }}
        filters={
          <BatchFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
          />
        }
        empty={{
          title: 'Chưa có lô hàng nào',
          description: 'Các phòng lạnh trong phạm vi của bạn chưa nhập lô hàng nào.',
          action: canCreate && <CreateBatchDialog />,
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                {canDelete && (
                  <SelectAllHead selection={selection} label="Chọn tất cả lô hàng trên trang" />
                )}
                <TableHead className="pl-4">Mã lô</TableHead>
                <TableHead className="hidden md:table-cell">Loại sản phẩm</TableHead>
                <TableHead className="hidden lg:table-cell">Phòng lạnh</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Số lượng</TableHead>
                <TableHead>Hạn sử dụng</TableHead>
                <TableHead className="pr-4">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((b) => {
                const product = productTypes.get(b.productTypeId)
                return (
                  <TableRow key={b.id}>
                    {canDelete && (
                      <SelectRowCell selection={selection} id={b.id} label={`Chọn lô hàng ${b.batchCode}`} />
                    )}
                    <TableCell className="pl-4 whitespace-normal">
                      <span className="font-mono text-sm" translate="no">
                        {b.batchCode}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground md:hidden">
                        {productTypes.label(b.productTypeId)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {productTypes.label(b.productTypeId)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {coldRooms.label(b.coldRoomId)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {formatNumber(b.quantity)}
                      {product && ` ${PRODUCT_UNIT_LABEL[product.unit]}`}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <time dateTime={b.expiryDate}>{formatDate(b.expiryDate)}</time>
                    </TableCell>
                    <TableCell className="pr-4">
                      <BatchStatusBadge status={b.status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </ListCard>
    </>
  )
}
