import { commandsApi, type CommandQuery } from '@/api/endpoints'
import type { Command, CommandAction, CommandStatus } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateCommandDialog } from '@/components/commands/CreateCommandDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  JsonBlock,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
import { PageHeader } from '@/components/common/PageHeader'
import { CommandStatusBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, labelOptions, rangeError } from '@/lib/filters'
import { formatDateTime, formatRelative } from '@/lib/format'
import { COMMAND_ACTION_LABEL, COMMAND_STATUS_LABEL } from '@/lib/labels'
import { shortId, useUserLookup, useWarehouseLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = [
  'status',
  'action',
  'warehouseId',
  'issuedBy',
  'createdFrom',
  'createdTo',
] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

function CommandFilterDialog({
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
      description="Thu hẹp lịch sử lệnh theo trạng thái, loại lệnh, kho, người gửi và thời điểm."
      validate={(d) => rangeError([d.createdFrom, d.createdTo, 'Thời điểm gửi'])}
    >
      {(draft, set) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectFilter
              id="f-status"
              label="Trạng thái"
              value={draft.status}
              options={labelOptions(COMMAND_STATUS_LABEL)}
              onChange={(v) => set('status', v)}
            />
            <SelectFilter
              id="f-action"
              label="Lệnh"
              value={draft.action}
              options={labelOptions(COMMAND_ACTION_LABEL)}
              onChange={(v) => set('action', v)}
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
              id="f-issuer"
              label="Người gửi"
              value={draft.issuedBy}
              options={users.options}
              onChange={(v) => set('issuedBy', v)}
            />
          )}
          <DateRangeFilter
            id="f-created"
            fromLabel="Gửi từ ngày"
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

export function CommandsPage() {
  const { user } = useAuth()
  const canCreate = hasRole(user?.role, ['admin', 'technician'])
  const isAdmin = hasRole(user?.role, ['admin'])
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const users = useUserLookup(isAdmin)
  const rows = useRowDialogs<Command>()
  const current = rows.item

  const params: CommandQuery = {
    page: list.page,
    limit: list.limit,
    status: param(f.status) as CommandStatus | undefined,
    action: param(f.action) as CommandAction | undefined,
    warehouseId: param(f.warehouseId),
    issuedBy: param(f.issuedBy),
    createdFrom: param(f.createdFrom),
    createdTo: param(f.createdTo),
  }
  const query = useQuery({
    queryKey: ['commands', params],
    queryFn: () => commandsApi.list(params),
    placeholderData: keepPreviousData,
  })

  const issuer = (id: string | null) => {
    if (!id) return 'Hệ thống'
    if (id === user?.id) return 'Bạn'
    return users.label(id)
  }

  return (
    <>
      <PageHeader title="Lệnh điều khiển" description="Lịch sử lệnh bật/tắt kênh thiết bị."
        actions={canCreate && <CreateCommandDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="lệnh"
        filters={
          <CommandFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
            isAdmin={isAdmin}
          />
        }
        empty={{
          title: 'Chưa có lệnh nào',
          description: 'Chưa có lệnh điều khiển nào được gửi tới thiết bị trong phạm vi của bạn.',
          action: canCreate && <CreateCommandDialog />,
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Thời điểm</TableHead>
                <TableHead>Lệnh</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Kênh</TableHead>
                <TableHead>Người gửi</TableHead>
                <TableHead>Xác nhận</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id} {...rowOpenProps(() => rows.view(c))}>
                  <TableCell className="pl-4 text-muted-foreground">
                    <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)}>
                      {formatRelative(c.createdAt)}
                    </time>
                  </TableCell>
                  <TableCell className="font-medium">{COMMAND_ACTION_LABEL[c.action]}</TableCell>
                  <TableCell>
                    <CommandStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell
                    className="font-mono text-sm text-muted-foreground"
                    title={c.channelId}
                    translate="no"
                  >
                    {shortId(c.channelId)}
                  </TableCell>
                  <TableCell>{issuer(c.issuedBy)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(c.ackAt)}
                  </TableCell>
                  <RowActionsCell
                    label={`lệnh ${COMMAND_ACTION_LABEL[c.action]} lúc ${formatDateTime(c.createdAt)}`}
                    onView={() => rows.view(c)}
                  />
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
          title={COMMAND_ACTION_LABEL[current.action]}
          description={formatDateTime(current.createdAt)}
        >
          <DetailList
            fields={[
              { label: 'Trạng thái', value: <CommandStatusBadge status={current.status} /> },
              { label: 'Người gửi', value: issuer(current.issuedBy) },
              { label: 'Gửi lúc', value: formatDateTime(current.createdAt) },
              { label: 'Xác nhận lúc', value: current.ackAt && formatDateTime(current.ackAt) },
              {
                label: 'Kênh',
                value: (
                  <span className="font-mono text-sm break-all" translate="no">
                    {current.channelId}
                  </span>
                ),
                full: true,
              },
              { label: 'Payload', value: <JsonBlock value={current.payload} />, full: true },
            ]}
          />
        </DetailDialog>
      )}
    </>
  )
}
