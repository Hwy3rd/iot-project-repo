import { alertsApi, type AlertQuery } from '@/api/endpoints'
import type { AlertStatus, AlertType } from '@/api/types'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, LocationFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import { AlertStatusBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, labelOptions, rangeError } from '@/lib/filters'
import { formatDateTime, formatRelative, formatTemp } from '@/lib/format'
import { ALERT_STATUS_LABEL, ALERT_TYPE_LABEL } from '@/lib/labels'
import { useColdRoomLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

// `status` doubles as the dashboard tiles' deep link (/alerts?status=open).
const FILTER_KEYS = [
  'status',
  'type',
  'warehouseId',
  'coldRoomId',
  'createdFrom',
  'createdTo',
] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function AlertFilterDialog({
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
      description="Thu hẹp cảnh báo theo trạng thái, loại, vị trí và thời điểm phát sinh."
      validate={(d) => rangeError([d.createdFrom, d.createdTo, 'Thời điểm'])}
    >
      {(draft, set, patch) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectFilter
              id="f-status"
              label="Trạng thái"
              value={draft.status}
              options={labelOptions(ALERT_STATUS_LABEL)}
              onChange={(v) => set('status', v)}
            />
            <SelectFilter
              id="f-type"
              label="Loại cảnh báo"
              value={draft.type}
              options={labelOptions(ALERT_TYPE_LABEL)}
              onChange={(v) => set('type', v)}
            />
          </div>
          <LocationFilter
            warehouseId={draft.warehouseId}
            coldRoomId={draft.coldRoomId}
            onChange={patch}
          />
          <DateRangeFilter
            id="f-created"
            fromLabel="Phát sinh từ ngày"
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

export function AlertsPage() {
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const coldRooms = useColdRoomLookup()

  const params: AlertQuery = {
    page: list.page,
    limit: list.limit,
    status: param(f.status) as AlertStatus | undefined,
    type: param(f.type) as AlertType | undefined,
    warehouseId: param(f.warehouseId),
    coldRoomId: param(f.coldRoomId),
    createdFrom: param(f.createdFrom),
    createdTo: param(f.createdTo),
  }
  const query = useQuery({
    queryKey: ['alerts', params],
    queryFn: () => alertsApi.list(params),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Cảnh báo" description="Theo dõi, tiếp nhận và xử lý cảnh báo." />
      <ListCard
        list={list}
        query={query}
        noun="cảnh báo"
        filters={
          <AlertFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
          />
        }
        empty={{
          title: 'Chưa có cảnh báo nào',
          description: 'Các phòng lạnh trong phạm vi của bạn chưa phát sinh cảnh báo.',
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Loại</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="hidden md:table-cell">Phòng lạnh</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Giá trị / ngưỡng</TableHead>
                <TableHead className="pr-4">Thời điểm</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-4 font-medium whitespace-normal">
                    {ALERT_TYPE_LABEL[a.type]}
                    <span className="mt-0.5 block font-normal text-muted-foreground md:hidden">
                      {coldRooms.label(a.coldRoomId)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <AlertStatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {coldRooms.label(a.coldRoomId)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {a.triggerValue === null
                      ? '—'
                      : `${formatTemp(a.triggerValue)} / ${formatTemp(a.threshold)}`}
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground">
                    <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                      {formatRelative(a.createdAt)}
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
