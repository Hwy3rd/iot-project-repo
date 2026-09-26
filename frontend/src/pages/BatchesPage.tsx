import { batchesApi, type BatchQuery } from '@/api/endpoints'
import type { Batch, BatchStatus } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateBatchDialog, EditBatchDialog } from '@/components/batches/BatchFormDialog'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { ColdRoomFilter, DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
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
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { BATCH_STATUS_LABEL, PRODUCT_UNIT_LABEL } from '@/lib/labels'
import { useColdRoomLookup, useProductTypeLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { useCurrentWarehouse } from '@/lib/useCurrentWarehouse'
import { useRowSelection } from '@/lib/useRowSelection'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = [
  'status',
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
      {(draft, set) => (
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
          <ColdRoomFilter value={draft.coldRoomId} onChange={(v) => set('coldRoomId', v)} />
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
  // Staff also need an active shift there; the backend checks that per batch.
  const canEdit = canCreate
  // A batch taken out of storage is history, not something to correct.
  const editable = (b: Batch) => canEdit && b.status !== 'removed'
  const rows = useRowDialogs<Batch>()
  const current = rows.item
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const coldRooms = useColdRoomLookup()
  const productTypes = useProductTypeLookup()
  const scope = useCurrentWarehouse()

  const params: BatchQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    status: param(f.status) as BatchStatus | undefined,
    warehouseId: param(scope.warehouseId),
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
    enabled: scope.ready,
  })
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).filter((b) => b.status !== 'removed').map((b) => ({ id: b.id, name: b.batchCode }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

  const currentProduct = productTypes.get(current?.productTypeId)

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
                <TableHead>Loại sản phẩm</TableHead>
                <TableHead>Phòng lạnh</TableHead>
                <TableHead className="text-right">Số lượng</TableHead>
                <TableHead>Hạn sử dụng</TableHead>
                <TableHead>Trạng thái</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((b) => {
                const product = productTypes.get(b.productTypeId)
                return (
                  <TableRow key={b.id} {...rowOpenProps(() => rows.view(b))}>
                    {canDelete && (
                      <SelectRowCell selection={selection} id={b.id} label={`Chọn lô hàng ${b.batchCode}`} />
                    )}
                    <TableCell className="pl-4 min-w-48 whitespace-normal">
                      <span className="font-mono text-sm" translate="no">
                        {b.batchCode}
                      </span>
                    </TableCell>
                    <TableCell>
                      {productTypes.label(b.productTypeId)}
                    </TableCell>
                    <TableCell>
                      {coldRooms.label(b.coldRoomId)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(b.quantity)}
                      {product && ` ${PRODUCT_UNIT_LABEL[product.unit]}`}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <time dateTime={b.expiryDate}>{formatDate(b.expiryDate)}</time>
                    </TableCell>
                    <TableCell>
                      <BatchStatusBadge status={b.status} />
                    </TableCell>
                    <RowActionsCell
                      label={`lô hàng ${b.batchCode}`}
                      onView={() => rows.view(b)}
                      onEdit={editable(b) ? () => rows.edit(b) : undefined}
                    />
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </ListCard>

      {current && (
        <>
          <DetailDialog
            open={rows.viewing}
            onClose={rows.close}
            title={<span className="font-mono" translate="no">{current.batchCode}</span>}
            description={productTypes.label(current.productTypeId)}
            onEdit={editable(current) ? () => rows.edit(current) : undefined}
            wide
          >
            <DetailList
              fields={[
                {
                  label: 'Mã lô',
                  value: <span className="font-mono" translate="no">{current.batchCode}</span>,
                },
                { label: 'Trạng thái', value: <BatchStatusBadge status={current.status} /> },
                { label: 'Loại sản phẩm', value: productTypes.label(current.productTypeId) },
                { label: 'Phòng lạnh', value: coldRooms.label(current.coldRoomId) },
                {
                  label: 'Số lượng',
                  value: `${formatNumber(current.quantity)}${
                    currentProduct ? ` ${PRODUCT_UNIT_LABEL[currentProduct.unit]}` : ''
                  }`,
                },
                { label: 'Nhà cung cấp', value: current.supplier },
                { label: 'Ngày nhập', value: formatDate(current.receivedAt) },
                { label: 'Hạn sử dụng', value: formatDate(current.expiryDate) },
                { label: 'Ngày xuất kho', value: current.removedAt && formatDateTime(current.removedAt) },
                { label: 'Cập nhật lần cuối', value: formatDateTime(current.updatedAt) },
                {
                  label: 'Ghi chú',
                  value: current.notes && <span className="whitespace-pre-line">{current.notes}</span>,
                  full: true,
                },
              ]}
            />
          </DetailDialog>
          {editable(current) && (
            <EditBatchDialog
              key={`${current.id}:${current.updatedAt}`}
              batch={current}
              open={rows.editing}
              onClose={rows.close}
            />
          )}
        </>
      )}
    </>
  )
}
