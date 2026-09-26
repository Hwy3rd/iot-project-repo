import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { useWarehouseLookup } from './lookups'
import { usePreference } from './usePreference'

/** The "Tất cả kho" choice; only Admin and Technician have it. */
export const ALL_WAREHOUSES = 'all'

/**
 * The warehouse the app is working in, picked in the header and remembered
 * per user in this browser. Every warehouse-bound screen (lists, dashboard,
 * monitoring, work shifts) scopes itself to it.
 *
 * Manager and Staff always work in one warehouse (default: the first one
 * they're assigned to). Admin and Technician usually look after several, so
 * they may also pick "Tất cả kho", their default.
 *
 * `warehouseId` is '' for "all" — pass it on as an unset filter — and also
 * while the warehouse list loads: gate queries on `ready` so a screen
 * doesn't briefly show every warehouse before settling on one.
 */
export function useCurrentWarehouse() {
  const { user } = useAuth()
  const warehouses = useWarehouseLookup()
  const allowAll = hasRole(user?.role, ['admin', 'technician'])
  const ids = warehouses.items.map((w) => w.id)
  const [value, setValue] = usePreference(
    `warehouse:${user?.id ?? ''}`,
    allowAll ? ALL_WAREHOUSES : (ids[0] ?? ''),
    allowAll ? [ALL_WAREHOUSES, ...ids] : ids,
  )
  const warehouseId = value === ALL_WAREHOUSES ? '' : value
  return {
    /** The selected warehouse, or '' for all of them. */
    warehouseId,
    warehouse: warehouses.get(warehouseId),
    /** Raw select value: a warehouse id or ALL_WAREHOUSES. */
    value,
    select: setValue,
    allowAll,
    warehouses,
    ready: warehouses.settled,
  }
}
