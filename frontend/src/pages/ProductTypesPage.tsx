import { productTypesApi, type ProductTypeQuery } from '@/api/endpoints'
import type { ProductUnit } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateProductTypeDialog } from '@/components/product-types/CreateProductTypeDialog'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import { SelectAllHead, SelectRowCell } from '@/components/common/row-selection'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, labelOptions } from '@/lib/filters'
import { formatTemp } from '@/lib/format'
import { PRODUCT_UNIT_LABEL } from '@/lib/labels'
import { param, useListParams } from '@/lib/useListParams'
import { useRowSelection } from '@/lib/useRowSelection'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = ['unit'] as const
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function tempRange(min: number | null, max: number | null) {
  if (min === null && max === null) return '—'
  if (min === null) return `≤ ${formatTemp(max)}`
  if (max === null) return `≥ ${formatTemp(min)}`
  return `${formatTemp(min)} – ${formatTemp(max)}`
}

export function ProductTypesPage() {
  const { user } = useAuth()
  const canCreate = hasRole(user?.role, ['admin'])
  const canDelete = hasRole(user?.role, ['admin'])
  const list = useListParams(FILTER_KEYS)

  const params: ProductTypeQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    unit: param(list.filters.unit) as ProductUnit | undefined,
  }
  const query = useQuery({
    queryKey: ['product-types', params],
    queryFn: () => productTypesApi.list(params),
    placeholderData: keepPreviousData,
  })
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).map((p) => ({ id: p.id, name: p.name }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

  return (
    <>
      <PageHeader
        title="Loại sản phẩm"
        description="Danh mục loại sản phẩm dùng chung."
        actions={canCreate && <CreateProductTypeDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="loại sản phẩm"
        selection={{
          count: selection.count,
          offPageCount: selection.offPageCount,
          onClear: selection.clear,
          actions: (
            <BulkDeleteDialog
              ids={selection.ids}
              noun="loại sản phẩm"
              bulkRemove={productTypesApi.bulkRemove}
              invalidate={[['product-types']]}
              onDone={selection.clear}
              describe={selection.nameOf}
            />
          ),
        }}
        search={{ label: 'Tìm loại sản phẩm', placeholder: 'Tìm theo tên hoặc nhóm hàng…' }}
        filters={
          <FilterDialog
            value={list.filters}
            emptyValue={NO_FILTERS}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
            description="Thu hẹp danh mục theo đơn vị tính."
          >
            {(draft, set) => (
              <SelectFilter
                id="f-unit"
                label="Đơn vị tính"
                value={draft.unit}
                options={labelOptions(PRODUCT_UNIT_LABEL)}
                onChange={(v) => set('unit', v)}
              />
            )}
          </FilterDialog>
        }
        empty={{
          title: 'Chưa có loại sản phẩm nào',
          description: 'Danh mục loại sản phẩm đang trống.',
          action: canCreate && <CreateProductTypeDialog />,
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                {canDelete && (
                  <SelectAllHead selection={selection} label="Chọn tất cả loại sản phẩm trên trang" />
                )}
                <TableHead className="pl-4">Tên</TableHead>
                <TableHead className="hidden sm:table-cell">Nhóm hàng</TableHead>
                <TableHead>Đơn vị</TableHead>
                <TableHead className="pr-4 text-right">Nhiệt độ bảo quản</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id}>
                  {canDelete && (
                    <SelectRowCell selection={selection} id={p.id} label={`Chọn loại sản phẩm ${p.name}`} />
                  )}
                  <TableCell className="pl-4 whitespace-normal">
                    <span className="font-medium">{p.name}</span>
                    {p.category && (
                      <span className="mt-0.5 block text-muted-foreground sm:hidden">
                        {p.category}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {p.category || '—'}
                  </TableCell>
                  <TableCell>{PRODUCT_UNIT_LABEL[p.unit]}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">
                    {tempRange(p.storageTempMin, p.storageTempMax)}
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
