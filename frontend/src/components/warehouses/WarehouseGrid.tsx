import type { ColdRoomStatus, Warehouse } from '@/api/types'
import { ToneBadge } from '@/components/common/StatusBadge'
import { StatusUnavailable } from '@/components/common/StatusUnavailable'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { PROBLEM_DEVICE_STATUSES, TEMP_STATE, TEMP_STATE_ORDER, tempState, type TempState } from '@/lib/room-status'
import type { RowSelection } from '@/lib/useRowSelection'
import { cn } from '@/lib/utils'
import { ArrowRight, Cpu, Siren, Thermometer } from 'lucide-react'
import { Link } from 'react-router'

interface Summary {
  rooms: number
  byState: Partial<Record<TempState, number>>
  devices: number
  problemDevices: number
  activeAlerts: number
}

function summarize(statuses: readonly ColdRoomStatus[]): Summary {
  const summary: Summary = { rooms: 0, byState: {}, devices: 0, problemDevices: 0, activeAlerts: 0 }
  for (const s of statuses) {
    summary.rooms++
    const state = tempState(s.latest)
    summary.byState[state] = (summary.byState[state] ?? 0) + 1
    summary.devices += s.devices.total
    for (const p of PROBLEM_DEVICE_STATUSES) summary.problemDevices += s.devices[p] ?? 0
    summary.activeAlerts += s.activeAlerts
  }
  return summary
}

// The worst room decides the card's accent.
function worstState(summary: Summary): TempState | null {
  return TEMP_STATE_ORDER.find((s) => summary.byState[s]) ?? null
}

const ACCENT: Record<TempState, string> = {
  ok: 'border-l-success',
  out: 'border-l-destructive',
  fault: 'border-l-destructive',
  stale: 'border-l-warning',
  none: 'border-l-border',
}

function WarehouseCard({
  warehouse,
  statuses,
  statusPending,
  statusError,
  selection,
}: {
  warehouse: Warehouse
  statuses: readonly ColdRoomStatus[]
  statusPending: boolean
  statusError: boolean
  selection?: RowSelection
}) {
  const summary = summarize(statuses)
  const worst = worstState(summary)
  const selectable = selection?.isSelectable(warehouse.id) ?? false

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-l-4 bg-card p-4 shadow-xs',
        worst ? ACCENT[worst] : 'border-l-border',
        selectable && selection?.isSelected(warehouse.id) && 'ring-2 ring-primary/40',
      )}
    >
      <header className="flex items-start gap-3">
        {selectable && (
          <Checkbox
            className="mt-1"
            checked={selection!.isSelected(warehouse.id)}
            onCheckedChange={(v) => selection!.toggle(warehouse.id, v === true)}
            aria-label={`Chọn kho ${warehouse.code}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm text-muted-foreground" translate="no">
            {warehouse.code}
          </p>
          <h3 className="font-semibold break-words">{warehouse.name}</h3>
          {warehouse.address && (
            <p className="line-clamp-1 text-sm text-muted-foreground">{warehouse.address}</p>
          )}
        </div>
      </header>

      {statusError ? (
        <p className="text-muted-foreground">Chưa có trạng thái phòng lạnh.</p>
      ) : statusPending ? (
        <Skeleton className="h-16 w-full" />
      ) : summary.rooms === 0 ? (
        <p className="text-muted-foreground">Chưa có phòng lạnh nào đang được giám sát.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <Thermometer className="size-4 text-muted-foreground" aria-hidden="true" />
            {formatNumber(summary.rooms)} phòng lạnh
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEMP_STATE_ORDER.filter((s) => summary.byState[s]).map((s) => (
              <ToneBadge key={s} tone={TEMP_STATE[s].tone}>
                {formatNumber(summary.byState[s])} {TEMP_STATE[s].label.toLowerCase()}
              </ToneBadge>
            ))}
          </div>
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Cpu className="size-4 shrink-0" aria-hidden="true" />
          {statusError || statusPending ? '—' : formatNumber(summary.devices)} thiết bị
          {summary.problemDevices > 0 && (
            <span className="text-warning"> · {formatNumber(summary.problemDevices)} cần kiểm tra</span>
          )}
        </span>
        {summary.activeAlerts > 0 && (
          <Link
            to={`/alerts?warehouseId=${warehouse.id}`}
            className="inline-flex items-center gap-1 font-medium text-destructive hover:underline"
          >
            <Siren className="size-4" aria-hidden="true" />
            {formatNumber(summary.activeAlerts)} cảnh báo
          </Link>
        )}
        <Link
          to={`/cold-rooms?warehouseId=${warehouse.id}&view=grid`}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Xem phòng lạnh
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </footer>
    </article>
  )
}

/** Warehouses as cards, each summing up the live state of its cold rooms. */
export function WarehouseGrid({
  warehouses,
  statuses,
  statusPending,
  statusError,
  selection,
}: {
  warehouses: Warehouse[]
  statuses: readonly ColdRoomStatus[]
  statusPending: boolean
  statusError: boolean
  selection?: RowSelection
}) {
  const byWarehouse = new Map<string, ColdRoomStatus[]>()
  for (const s of statuses) {
    const list = byWarehouse.get(s.warehouseId)
    if (list) list.push(s)
    else byWarehouse.set(s.warehouseId, [s])
  }
  return (
    <>
      {statusError && <StatusUnavailable />}
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {warehouses.map((w) => (
          <WarehouseCard
            key={w.id}
            warehouse={w}
            statuses={byWarehouse.get(w.id) ?? []}
            statusPending={statusPending}
            statusError={statusError}
            selection={selection}
          />
        ))}
      </div>
    </>
  )
}
