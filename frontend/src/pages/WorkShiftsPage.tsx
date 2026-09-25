import { workShiftsApi, type WorkShiftQuery } from '@/api/endpoints'
import type { WorkShift, WorkShiftStatus } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { CreateWorkShiftDialog, EditWorkShiftDialog } from '@/components/work-shifts/WorkShiftFormDialog'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
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
import { SelectAllHead, SelectRowCell } from '@/components/common/row-selection'
import { WorkShiftStatusBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, labelOptions, rangeError } from '@/lib/filters'
import { dayjs, formatDate, formatDateTime } from '@/lib/format'
import { WORK_SHIFT_STATUS_LABEL } from '@/lib/labels'
import { useShiftLookup, useUserLookup, useWarehouseLookup } from '@/lib/lookups'
import { param, useListParams } from '@/lib/useListParams'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { useRowSelection } from '@/lib/useRowSelection'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = [
  'status',
  'warehouseId',
  'shiftId',
  'staffId',
  'workDateFrom',
  'workDateTo',
] as const
type Filters = Record<(typeof FILTER_KEYS)[number], string>
const NO_FILTERS = emptyFilters(FILTER_KEYS)

const time = (iso: string | null) => (iso ? dayjs(iso).format('HH:mm') : '—')

function WorkShiftFilterDialog({
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
  const shifts = useShiftLookup()
  const users = useUserLookup(isAdmin)
  return (
    <FilterDialog
      value={value}
      emptyValue={NO_FILTERS}
      activeCount={activeCount}
      onApply={onApply}
      description="Thu hẹp lịch ca trực theo trạng thái, kho, ca, nhân viên và ngày trực."
      validate={(d) => rangeError([d.workDateFrom, d.workDateTo, 'Ngày trực'])}
    >
      {(draft, set) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectFilter
              id="f-status"
              label="Trạng thái"
              value={draft.status}
              options={labelOptions(WORK_SHIFT_STATUS_LABEL)}
              onChange={(v) => set('status', v)}
            />
            <SelectFilter
              id="f-shift"
              label="Ca"
              value={draft.shiftId}
              options={shifts.options}
              onChange={(v) => set('shiftId', v)}
            />
          </div>
          <SelectFilter
            id="f-warehouse"
            label="Kho"
            value={draft.warehouseId}
            options={warehouses.options}
            onChange={(v) => set('warehouseId', v)}
          />
          {/* Staff names come from GET /users, which only Admin may call. */}
          {isAdmin && (
            <SelectFilter
              id="f-staff"
              label="Nhân viên"
              value={draft.staffId}
              options={users.items
                .filter((u) => u.role === 'staff')
                .map((u) => ({ value: u.id, label: users.label(u.id) }))}
              onChange={(v) => set('staffId', v)}
            />
          )}
          <DateRangeFilter
            id="f-work-date"
            fromLabel="Trực từ ngày"
            from={draft.workDateFrom}
            to={draft.workDateTo}
            onFromChange={(v) => set('workDateFrom', v)}
            onToChange={(v) => set('workDateTo', v)}
          />
        </>
      )}
    </FilterDialog>
  )
}

export function WorkShiftsPage() {
  const { user } = useAuth()
  const canCreate = hasRole(user?.role, ['admin', 'manager'])
  const isAdmin = hasRole(user?.role, ['admin'])
  const canDelete = hasRole(user?.role, ['admin', 'manager'])
  // Only upcoming shifts: once checked in, the record is attendance history.
  const editable = (w: WorkShift) => canCreate && w.status === 'scheduled'
  const rows = useRowDialogs<WorkShift>()
  const current = rows.item
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const warehouses = useWarehouseLookup()
  const shifts = useShiftLookup()
  const users = useUserLookup(isAdmin)

  const params: WorkShiftQuery = {
    page: list.page,
    limit: list.limit,
    status: param(f.status) as WorkShiftStatus | undefined,
    warehouseId: param(f.warehouseId),
    shiftId: param(f.shiftId),
    staffId: param(f.staffId),
    workDateFrom: param(f.workDateFrom),
    workDateTo: param(f.workDateTo),
  }
  const query = useQuery({
    queryKey: ['work-shifts', params],
    queryFn: () => workShiftsApi.list(params),
    placeholderData: keepPreviousData,
  })
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).map((w) => ({ id: w.id, name: `${shifts.label(w.shiftId)} ${formatDate(w.workDate)}` }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

  const staffName = (id: string) => (id === user?.id ? 'Bạn' : users.label(id))

  return (
    <>
      <PageHeader
        title="Ca trực"
        description="Lịch ca trực và check-in/check-out."
        actions={canCreate && <CreateWorkShiftDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="ca trực"
        selection={{
          count: selection.count,
          offPageCount: selection.offPageCount,
          onClear: selection.clear,
          actions: (
            <BulkDeleteDialog
              ids={selection.ids}
              noun="ca trực"
              bulkRemove={workShiftsApi.bulkRemove}
              invalidate={[['work-shifts']]}
              onDone={selection.clear}
              describe={selection.nameOf}
            />
          ),
        }}
        filters={
          <WorkShiftFilterDialog
            value={list.filters}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
            isAdmin={isAdmin}
          />
        }
        empty={{
          title: 'Chưa có ca trực nào',
          description: 'Chưa có lịch ca trực nào trong phạm vi của bạn.',
          action: canCreate && <CreateWorkShiftDialog />,
        }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                {canDelete && (
                  <SelectAllHead selection={selection} label="Chọn tất cả ca trực trên trang" />
                )}
                <TableHead className="pl-4">Ngày trực</TableHead>
                <TableHead>Ca</TableHead>
                <TableHead>Nhân viên</TableHead>
                <TableHead>Kho</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Vào / ra</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((w) => (
                <TableRow key={w.id} {...rowOpenProps(() => rows.view(w))}>
                  {canDelete && (
                    <SelectRowCell selection={selection} id={w.id} label={`Chọn ca trực ${w.workDate}`} />
                  )}
                  <TableCell className="pl-4 tabular-nums">
                    <time dateTime={w.workDate}>{formatDate(w.workDate)}</time>
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    {shifts.label(w.shiftId)}
                    <span className="block text-muted-foreground tabular-nums">
                      {time(w.scheduledStartAt)} – {time(w.scheduledEndAt)}
                    </span>
                  </TableCell>
                  <TableCell>{staffName(w.staffId)}</TableCell>
                  <TableCell>
                    {warehouses.label(w.warehouseId)}
                  </TableCell>
                  <TableCell>
                    <WorkShiftStatusBadge status={w.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {time(w.checkInAt)} / {time(w.checkOutAt)}
                  </TableCell>
                  <RowActionsCell
                    label={`ca trực ngày ${formatDate(w.workDate)}`}
                    onView={() => rows.view(w)}
                    onEdit={editable(w) ? () => rows.edit(w) : undefined}
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
            title={`${shifts.label(current.shiftId)} · ${formatDate(current.workDate)}`}
            description={warehouses.label(current.warehouseId)}
            onEdit={editable(current) ? () => rows.edit(current) : undefined}
          >
            <DetailList
              fields={[
                { label: 'Ngày trực', value: formatDate(current.workDate) },
                { label: 'Ca', value: shifts.label(current.shiftId) },
                {
                  label: 'Giờ theo lịch',
                  value: `${time(current.scheduledStartAt)} – ${time(current.scheduledEndAt)}`,
                },
                { label: 'Trạng thái', value: <WorkShiftStatusBadge status={current.status} /> },
                { label: 'Nhân viên', value: staffName(current.staffId) },
                { label: 'Kho', value: warehouses.label(current.warehouseId) },
                { label: 'Vào ca lúc', value: formatDateTime(current.checkInAt) },
                { label: 'Ra ca lúc', value: formatDateTime(current.checkOutAt) },
              ]}
            />
          </DetailDialog>
          {editable(current) && (
            <EditWorkShiftDialog
              key={`${current.id}:${current.updatedAt}`}
              workShift={current}
              open={rows.editing}
              onClose={rows.close}
            />
          )}
        </>
      )}
    </>
  )
}
