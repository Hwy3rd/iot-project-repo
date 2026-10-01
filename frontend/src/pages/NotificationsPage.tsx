import { notificationsApi, type NotificationQuery } from '@/api/endpoints'
import type { AppNotification } from '@/api/types'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
import { PageHeader } from '@/components/common/PageHeader'
import { EnablePushButton } from '@/components/notifications/PushNotifications'
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
import { param, patchParams, useListParams } from '@/lib/useListParams'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'

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
  const rows = useRowDialogs<AppNotification>()
  const current = rows.item
  const qc = useQueryClient()
  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // Opening one reads it (the bell counts unread ones).
  const view = (n: AppNotification) => {
    rows.view(n.readAt ? n : { ...n, readAt: new Date().toISOString() })
    if (!n.readAt) markRead.mutate(n.id)
  }

  // Clicked on the device (public/sw.js links to ?open=<id>): mark it read
  // and show it, whichever page of the list it's on.
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('open')
  useEffect(() => {
    if (!openId) return
    setSearchParams((prev) => patchParams(prev, { open: null }), { replace: true })
    markRead.mutate(openId, {
      onSuccess: (n) => rows.view(n),
      onError: () => toast.error('Không tìm thấy thông báo này'),
    })
    // Once per ?open= value; markRead/rows are fresh objects every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

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
      <PageHeader title="Thông báo" description="Thông báo của bạn." actions={<EnablePushButton />} />
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
                <TableHead>Trạng thái</TableHead>
                <TableHead>Thời điểm</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((n) => (
                <TableRow key={n.id} {...rowOpenProps(() => view(n))}>
                  <TableCell className="max-w-xl min-w-64 pl-4 whitespace-normal">
                    <span className={n.readAt ? 'font-normal' : 'font-semibold'}>{n.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-muted-foreground">{n.body}</span>
                  </TableCell>
                  <TableCell>
                    {n.readAt ? (
                      <ToneBadge>Đã đọc</ToneBadge>
                    ) : (
                      <ToneBadge tone="info">Chưa đọc</ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                      {formatRelative(n.createdAt)}
                    </time>
                  </TableCell>
                  <RowActionsCell label={`thông báo ${n.title}`} onView={() => view(n)} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>

      {current && (
        <DetailDialog
          open={rows.viewing}
          onClose={rows.close}
          title={current.title}
          description={formatDateTime(current.createdAt)}
        >
          <DetailList
            fields={[
              {
                label: 'Nội dung',
                value: <span className="whitespace-pre-line">{current.body}</span>,
                full: true,
              },
              {
                label: 'Trạng thái',
                value: current.readAt ? <ToneBadge>Đã đọc</ToneBadge> : <ToneBadge tone="info">Chưa đọc</ToneBadge>,
              },
              { label: 'Tạo lúc', value: formatDateTime(current.createdAt) },
              { label: 'Gửi lúc', value: current.sentAt && formatDateTime(current.sentAt) },
              { label: 'Đọc lúc', value: current.readAt && formatDateTime(current.readAt) },
            ]}
          />
        </DetailDialog>
      )}
    </>
  )
}
