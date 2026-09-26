import { productTypesApi, type ProductTypeQuery } from '@/api/endpoints'
import type { ProductType, ProductUnit } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import {
  CreateProductTypeDialog,
  EditProductTypeDialog,
} from '@/components/product-types/ProductTypeFormDialog'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
import { ImageGallery } from '@/components/common/ImageGallery'
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
import { formatDateTime, formatTemp } from '@/lib/format'
import { PRODUCT_UNIT_LABEL } from '@/lib/labels'
import { param, useListParams } from '@/lib/useListParams'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
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
  const canEdit = canCreate
  const rows = useRowDialogs<ProductType>()
  const current = rows.item
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
                <TableHead>Nhóm hàng</TableHead>
                <TableHead>Đơn vị</TableHead>
                <TableHead className="text-right">Nhiệt độ bảo quản</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} {...rowOpenProps(() => rows.view(p))}>
                  {canDelete && (
                    <SelectRowCell selection={selection} id={p.id} label={`Chọn loại sản phẩm ${p.name}`} />
                  )}
                  <TableCell className="pl-4 min-w-48 whitespace-normal">
                    <span className="font-medium">{p.name}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.category || '—'}
                  </TableCell>
                  <TableCell>{PRODUCT_UNIT_LABEL[p.unit]}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tempRange(p.storageTempMin, p.storageTempMax)}
                  </TableCell>
                  <RowActionsCell
                    label={`loại sản phẩm ${p.name}`}
                    onView={() => rows.view(p)}
                    onEdit={canEdit ? () => rows.edit(p) : undefined}
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
            title={current.name}
            description={current.category ?? undefined}
            onEdit={canEdit ? () => rows.edit(current) : undefined}
          >
            <DetailList
              fields={[
                { label: 'Tên', value: current.name },
                { label: 'Nhóm hàng', value: current.category },
                { label: 'Đơn vị tính', value: PRODUCT_UNIT_LABEL[current.unit] },
                {
                  label: 'Nhiệt độ bảo quản',
                  value: tempRange(current.storageTempMin, current.storageTempMax),
                },
                { label: 'Ngày tạo', value: formatDateTime(current.createdAt) },
                { label: 'Cập nhật lần cuối', value: formatDateTime(current.updatedAt) },
              ]}
            />
            <ImageGallery
              images={current.imageUrls}
              canEdit={canEdit}
              upload={(files) => productTypesApi.addImages(current.id, files)}
              remove={(url) => productTypesApi.removeImage(current.id, url)}
              invalidate={[['product-types']]}
              onChanged={(updated) => rows.view(updated as ProductType)}
              noun="loại sản phẩm"
            />
          </DetailDialog>
          {canEdit && (
            <EditProductTypeDialog
              key={`${current.id}:${current.updatedAt}`}
              productType={current}
              open={rows.editing}
              onClose={rows.close}
            />
          )}
        </>
      )}
    </>
  )
}
