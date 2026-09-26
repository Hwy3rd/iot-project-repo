import { alertsApi, batchesApi, devicesApi, type AlertQuery } from '@/api/endpoints'
import type { Alert, AlertStatus, AlertType } from '@/api/types'
import { FilterDialog } from '@/components/common/FilterDialog'
import { DateRangeFilter, LocationFilter, SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  JsonBlock,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
import { PageHeader } from '@/components/common/PageHeader'
import { StatGrid, StatTile } from '@/components/common/StatTile'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { Button } from '@/components/ui/button'
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
import { shortId, useColdRoomLookup, useUserLookup } from '@/lib/lookups'
import { useAlertActions } from '@/lib/useAlertActions'
import { param, useListParams } from '@/lib/useListParams'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BellRing, CheckCheck, Loader2, Siren } from 'lucide-react'

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

// Only `total` is needed for the tiles, so ask for a single row.
const COUNT = { limit: 1 } as const

function AlertStats() {
  const open = useQuery({
    queryKey: ['alerts', { status: 'open', ...COUNT }],
    queryFn: () => alertsApi.list({ status: 'open', ...COUNT }),
  })
  const acknowledged = useQuery({
    queryKey: ['alerts', { status: 'acknowledged', ...COUNT }],
    queryFn: () => alertsApi.list({ status: 'acknowledged', ...COUNT }),
  })
  return (
    <StatGrid>
      <StatTile
        label="Đang mở"
        value={open.data?.meta.total}
        icon={Siren}
        to="/alerts?status=open"
        tone="text-destructive bg-destructive/10"
      />
      <StatTile
        label="Đã tiếp nhận, chờ xử lý"
        value={acknowledged.data?.meta.total}
        icon={BellRing}
        to="/alerts?status=acknowledged"
        tone="text-warning bg-warning/10"
      />
    </StatGrid>
  )
}

/** "Tiếp nhận" / "Xử lý xong" for one alert, as far as the caller may. */
function AlertActionButtons({
  alert,
  size = 'sm',
  onDone,
}: {
  alert: Alert
  size?: 'sm' | 'default'
  onDone?: (updated: Alert) => void
}) {
  const actions = useAlertActions()
  const busy = actions.pendingId === alert.id
  const act = async (action: 'acknowledge' | 'resolve') => {
    const updated = await actions.run(alert, action)
    if (updated) onDone?.(updated)
  }
  return (
    <>
      {actions.canAcknowledge(alert) && (
        <Button type="button" size={size} variant="outline" disabled={busy} onClick={() => act('acknowledge')}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <BellRing aria-hidden="true" />}
          Tiếp nhận
        </Button>
      )}
      {actions.canResolve(alert) && (
        <Button type="button" size={size} variant="outline" disabled={busy} onClick={() => act('resolve')}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
          Xử lý xong
        </Button>
      )}
    </>
  )
}

/** Who acted on an alert: "Bạn", a name (Admins can list users), or a short id. */
function useActorName() {
  const { user } = useAuth()
  const users = useUserLookup(hasRole(user?.role, ['admin']))
  return (id: string | null) => (!id ? null : id === user?.id ? 'Bạn' : users.label(id))
}

export function AlertsPage() {
  const list = useListParams(FILTER_KEYS)
  const f = list.filters
  const coldRooms = useColdRoomLookup()
  const rows = useRowDialogs<Alert>()
  const current = rows.item
  const { user } = useAuth()
  const actorName = useActorName()
  // Names instead of ids in the detail — each lookup only where the caller may read it.
  const device = useQuery({
    queryKey: ['devices', current?.deviceId],
    queryFn: () => devicesApi.get(current!.deviceId!),
    enabled: rows.viewing && !!current?.deviceId,
    retry: false,
  })
  const batch = useQuery({
    queryKey: ['batches', current?.batchId],
    queryFn: () => batchesApi.get(current!.batchId!),
    enabled: rows.viewing && !!current?.batchId && hasRole(user?.role, ['admin', 'manager', 'staff']),
    retry: false,
  })

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
      <AlertStats />
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
                <TableHead>Phòng lạnh</TableHead>
                <TableHead className="text-right">Giá trị / ngưỡng</TableHead>
                <TableHead>Thời điểm</TableHead>
                <TableHead>
                  <span className="sr-only">Xử lý</span>
                </TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id} {...rowOpenProps(() => rows.view(a))}>
                  <TableCell className="pl-4 font-medium min-w-48 whitespace-normal">
                    {ALERT_TYPE_LABEL[a.type]}
                  </TableCell>
                  <TableCell>
                    <AlertStatusBadge status={a.status} />
                  </TableCell>
                  <TableCell>
                    {coldRooms.label(a.coldRoomId)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.triggerValue === null
                      ? '—'
                      : `${formatTemp(a.triggerValue)} / ${formatTemp(a.threshold)}`}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                      {formatRelative(a.createdAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <AlertActionButtons alert={a} />
                    </div>
                  </TableCell>
                  <RowActionsCell
                    label={`cảnh báo ${ALERT_TYPE_LABEL[a.type]} lúc ${formatDateTime(a.createdAt)}`}
                    onView={() => rows.view(a)}
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
          title={ALERT_TYPE_LABEL[current.type]}
          description={coldRooms.label(current.coldRoomId)}
          wide
          actions={<AlertActionButtons alert={current} size="default" onDone={rows.view} />}
        >
          <DetailList
            fields={[
              { label: 'Trạng thái', value: <AlertStatusBadge status={current.status} /> },
              { label: 'Phòng lạnh', value: coldRooms.label(current.coldRoomId) },
              {
                label: 'Giá trị / ngưỡng',
                value:
                  current.triggerValue === null
                    ? null
                    : `${formatTemp(current.triggerValue)} / ${formatTemp(current.threshold)}`,
              },
              { label: 'Thời điểm', value: formatDateTime(current.createdAt) },
              {
                label: 'Thiết bị',
                value: current.deviceId && (
                  <span className="font-mono" translate="no">
                    {device.data?.uniqueId ?? shortId(current.deviceId)}
                  </span>
                ),
              },
              {
                label: 'Lô hàng',
                value: current.batchId && (
                  <span className="font-mono" translate="no">
                    {batch.data?.batchCode ?? shortId(current.batchId)}
                  </span>
                ),
              },
              {
                label: 'Tiếp nhận',
                value:
                  current.acknowledgedAt &&
                  [formatDateTime(current.acknowledgedAt), actorName(current.acknowledgedBy)]
                    .filter(Boolean)
                    .join(' · '),
              },
              {
                label: 'Xử lý',
                value:
                  current.resolvedAt &&
                  (current.resolution === 'auto'
                    ? `${formatDateTime(current.resolvedAt)} · tự động (chỉ số đã trở lại bình thường)`
                    : [formatDateTime(current.resolvedAt), actorName(current.resolvedBy)]
                        .filter(Boolean)
                        .join(' · ')),
              },
              { label: 'Chi tiết', value: <JsonBlock value={current.details} />, full: true },
            ]}
          />
        </DetailDialog>
      )}
    </>
  )
}
