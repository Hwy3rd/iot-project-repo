import { notificationsApi, type NotificationQuery } from '@/api/endpoints'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import { ToneBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, rangeError } from '@/lib/filters'
import { formatDateTime, formatRelative } from '@/lib/format'
import { param, useListParams } from '@/lib/useListParams'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = ['unreadOnly', 'createdFrom', 'createdTo'] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function NotificationFilterDialog({
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
      description="Thu hẹp thông báo theo trạng thái đọc và thời điểm nhận."
      validate={(d) => rangeError([d.createdFrom, d.createdTo, 'Thời điểm'])}
    >
      {(draft, set) => (
        <>
          <SelectFilter
            id="f-unread"
            label="Trạng thái"
            value={draft.unreadOnly}
            options={[{ value: 'true', label: 'Chỉ thông báo chưa đọc' }]}
            onChange={(v) => set('unreadOnly', v)}
          />
          <DateRangeFilter
            id="f-created"
            fromLabel="Nhận từ ngày"
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

export function NotificationsPage() {
  const list = useListParams(FILTER_KEYS)
  const f = list.filters

  const params: NotificationQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    unreadOnly: f.unreadOnly === 'true' || undefined,
    createdFrom: param(f.createdFrom),
    createdTo: param(f.createdTo),
  }
  const query = useQuery({
    queryKey: ['notifications', params],
    queryFn: () => notificationsApi.list(params),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Thông báo" description="Thông báo của bạn." />
      <ListCard
        list={list}
        query={query}
        noun="thông báo"
        search={{ label: 'Tìm thông báo', placeholder: 'Tìm theo tiêu đề hoặc nội dung…' }}
        filters={
          <NotificationFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
          />
        }
        empty={{
          title: 'Chưa có thông báo nào',
          description: 'Thông báo về cảnh báo trong phạm vi của bạn sẽ xuất hiện ở đây.',
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Nội dung</TableHead>
                <TableHead className="hidden sm:table-cell">Trạng thái</TableHead>
                <TableHead className="pr-4">Thời điểm</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="max-w-xl pl-4 whitespace-normal">
                    <span className={n.readAt ? 'font-normal' : 'font-semibold'}>{n.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-muted-foreground">{n.body}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {n.readAt ? (
                      <ToneBadge>Đã đọc</ToneBadge>
                    ) : (
                      <ToneBadge tone="info">Chưa đọc</ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 align-top text-muted-foreground">
                    <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                      {formatRelative(n.createdAt)}
                    </time>
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
