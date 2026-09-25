import type { Paginated } from '@/api/types'
import { Pagination } from '@/components/common/Pagination'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/** The parts of useListParams() the card drives. */
interface ListState {
  search: string
  isFiltered: boolean
  setSearch: (q: string) => void
  setPage: (n: number) => void
  clearAll: () => void
}

/**
 * The card every management list shares: search box + filter button on top,
 * then loading / error / empty states or the table, then pagination.
 * Pages supply the FilterDialog, the table body and the unfiltered empty state.
 */
export function ListCard<T>({
  list,
  query,
  search,
  filters,
  noun,
  empty,
  selection,
  toolbarEnd,
  children,
}: {
  list: ListState
  query: UseQueryResult<Paginated<T>>
  /** Omit for endpoints without full-text search. */
  search?: { label: string; placeholder: string }
  /** Usually a <FilterDialog>. */
  filters?: ReactNode
  /** What a row is, for "Tìm thấy 12 {noun}" and "Không tìm thấy {noun} phù hợp". */
  noun: string
  /** Shown when the list is empty and nothing is filtered. */
  empty: { title: string; description?: ReactNode; action?: ReactNode }
  /** Right end of the toolbar, e.g. a table/grid switch. */
  toolbarEnd?: ReactNode
  /** Bulk-action bar, shown while rows are checked. */
  selection?: { count: number; offPageCount: number; onClear: () => void; actions: ReactNode }
  children: (items: T[]) => ReactNode
}) {
  const clearButton = (
    <Button variant="outline" onClick={list.clearAll}>
      Xoá tìm kiếm & bộ lọc
    </Button>
  )

  return (
    <Card className="gap-0 py-0 shadow-sm">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        {search && (
          <SearchInput
            value={list.search}
            onSearch={list.setSearch}
            label={search.label}
            placeholder={search.placeholder}
            className="sm:max-w-sm"
          />
        )}
        <div className="flex items-center gap-2">
          {filters}
          {list.isFiltered && (
            <Button variant="ghost" size="lg" onClick={list.clearAll}>
              Xoá lọc
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 sm:ml-auto">
          {list.isFiltered && query.data && (
            <p className="text-muted-foreground tabular-nums" aria-live="polite">
              Tìm thấy {formatNumber(query.data.meta.total)} {noun}
            </p>
          )}
          {toolbarEnd}
        </div>
      </div>

      {selection && selection.count > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2.5"
          aria-live="polite"
        >
          <p className="tabular-nums">
            <span className="font-medium">
              Đã chọn {formatNumber(selection.count)} {noun}
            </span>
            {selection.offPageCount > 0 && (
              <span className="text-muted-foreground">
                {' '}
                (gồm {formatNumber(selection.offPageCount)} ở trang khác)
              </span>
            )}
          </p>
          <Button variant="ghost" size="lg" onClick={selection.onClear}>
            Bỏ chọn
          </Button>
          <div className="ml-auto flex items-center gap-2">{selection.actions}</div>
        </div>
      )}

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
              title={`Không tìm thấy ${noun} phù hợp`}
              description={
                search ? 'Thử từ khoá khác hoặc bỏ bớt bộ lọc.' : 'Thử bỏ bớt hoặc nới rộng bộ lọc.'
              }
              action={clearButton}
            />
          ) : (
            <EmptyState {...empty} />
          )
        ) : (
          <div aria-busy={query.isFetching}>{children(query.data.items)}</div>
        )}
        {query.data && <Pagination meta={query.data.meta} />}
      </CardContent>
    </Card>
  )
}
