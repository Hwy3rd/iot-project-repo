import { auditLogsApi, type AuditLogQuery } from '@/api/endpoints'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter, TextFilter } from '@/components/common/filter-fields'
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
import { formatDateTime, formatRelative } from '@/lib/format'
import { shortId, useUserLookup, useWarehouseLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = [
  'action',
  'targetType',
  'warehouseId',
  'userId',
  'createdFrom',
  'createdTo',
] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function AuditLogFilterDialog({
  value,
  activeCount,
  onApply,
  isAdmin,
}: {
  value: Filters
  activeCount: number
  onApply: (next: Filters) => void
  isAdmin: boolean
}) {
  const warehouses = useWarehouseLookup()
  const users = useUserLookup(isAdmin)
  return (
    <FilterDialog
      value={value}
      emptyValue={NO_FILTERS}
      activeCount={activeCount}
      onApply={onApply}
      description="Thu hẹp nhật ký theo thao tác, đối tượng, kho, người thực hiện và thời điểm."
      validate={(d) => rangeError([d.createdFrom, d.createdTo, 'Thời điểm'])}
    >
      {(draft, set) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextFilter
              id="f-action"
              label="Thao tác"
              placeholder="vd. warehouse.update"
              value={draft.action}
              onChange={(v) => set('action', v)}
            />
            <TextFilter
              id="f-target-type"
              label="Loại đối tượng"
              placeholder="vd. warehouse"
              value={draft.targetType}
              onChange={(v) => set('targetType', v)}
            />
          </div>
          <SelectFilter
            id="f-warehouse"
            label="Kho"
            value={draft.warehouseId}
            options={warehouses.options}
            onChange={(v) => set('warehouseId', v)}
          />
          {/* User names come from GET /users, which only Admin may call. */}
          {isAdmin && (
            <SelectFilter
              id="f-user"
              label="Người thực hiện"
              value={draft.userId}
              options={users.options}
              onChange={(v) => set('userId', v)}
            />
          )}
          <DateRangeFilter
            id="f-created"
            fromLabel="Từ ngày"
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

export function AuditLogsPage() {
  const { user } = useAuth()
  const isAdmin = hasRole(user?.role, ['admin'])
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const warehouses = useWarehouseLookup()
  const users = useUserLookup(isAdmin)

  const params: AuditLogQuery = {
    page: list.page,
    limit: list.limit,
    action: param(f.action),
    targetType: param(f.targetType),
    warehouseId: param(f.warehouseId),
    userId: param(f.userId),
    createdFrom: param(f.createdFrom),
    createdTo: param(f.createdTo),
  }
  const query = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => auditLogsApi.list(params),
    placeholderData: keepPreviousData,
  })

  const actor = (id: string | null) => {
    if (!id) return 'Hệ thống'
    if (id === user?.id) return 'Bạn'
    return users.label(id)
  }

  return (
    <>
      <PageHeader title="Nhật ký hệ thống" description="Nhật ký thao tác (chỉ xem)." />
      <ListCard
        list={list}
        query={query}
        noun="bản ghi"
        filters={
          <AuditLogFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
            isAdmin={isAdmin}
          />
        }
        empty={{
          title: 'Chưa có nhật ký nào',
          description: 'Các thao tác thay đổi dữ liệu trong phạm vi của bạn sẽ được ghi lại ở đây.',
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Thời điểm</TableHead>
                <TableHead>Thao tác</TableHead>
                <TableHead className="hidden sm:table-cell">Người thực hiện</TableHead>
                <TableHead className="hidden md:table-cell">Đối tượng</TableHead>
                <TableHead className="hidden pr-4 lg:table-cell">Kho</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="pl-4 text-muted-foreground">
                    <time dateTime={l.createdAt} title={formatDateTime(l.createdAt)}>
                      {formatRelative(l.createdAt)}
                    </time>
                  </TableCell>
                  <TableCell className="font-mono text-sm" translate="no">
                    {l.action}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{actor(l.userId)}</TableCell>
                  <TableCell className="hidden font-mono text-sm md:table-cell" translate="no">
                    {l.targetType ?? '—'}
                    {l.targetId && (
                      <span className="text-muted-foreground" title={l.targetId}>
                        {' '}
                        {shortId(l.targetId)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden pr-4 lg:table-cell">
                    {warehouses.label(l.warehouseId)}
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
