import {
  coldRoomsApi,
  productTypesApi,
  shiftsApi,
  usersApi,
  warehousesApi,
} from '@/api/endpoints'
import type { Paginated } from '@/api/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

// List responses carry only foreign-key ids, so tables and filter dropdowns
// resolve names from one page of the referenced resource. The query keys
// start with the resource name, so a mutation that invalidates e.g.
// ['warehouses'] refreshes these too.
const LOOKUP = { limit: 100 } as const

export interface Option {
  value: string
  label: string
}

/** Stand-in when an id isn't in the first 100 rows (or isn't visible to the caller). */
export const shortId = (id: string) => `#${id.slice(-6)}`

function useLookup<T extends { id: string }>(
  resource: string,
  fetchPage: (q: typeof LOOKUP) => Promise<Paginated<T>>,
  toLabel: (item: T) => string,
  enabled = true,
) {
  const query = useQuery({
    queryKey: [resource, LOOKUP],
    queryFn: () => fetchPage(LOOKUP),
    staleTime: 5 * 60_000,
    enabled,
  })
  return useMemo(() => {
    const items = query.data?.items ?? []
    const byId = new Map(items.map((item) => [item.id, item]))
    return {
      items,
      options: items.map((item): Option => ({ value: item.id, label: toLabel(item) })),
      get: (id: string | null | undefined) => (id ? byId.get(id) : undefined),
      label: (id: string | null | undefined) => {
        if (!id) return '—'
        const item = byId.get(id)
        return item ? toLabel(item) : shortId(id)
      },
    }
    // toLabel is a module-level function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data])
}

const warehouseLabel = (w: { name: string; code: string }) => `${w.name} (${w.code})`
const nameLabel = (x: { name: string }) => x.name
const userLabel = (u: { username: string; fullName: string | null }) =>
  u.fullName ? `${u.fullName} (${u.username})` : u.username

export const useWarehouseLookup = () =>
  useLookup('warehouses', warehousesApi.list, warehouseLabel)
export const useColdRoomLookup = () => useLookup('cold-rooms', coldRoomsApi.list, nameLabel)
export const useProductTypeLookup = () =>
  useLookup('product-types', productTypesApi.list, nameLabel)
export const useShiftLookup = () => useLookup('shifts', shiftsApi.list, nameLabel)
/** GET /users is Admin-only; pass enabled=false for other roles (names fall back to ids). */
export const useUserLookup = (enabled: boolean) =>
  useLookup('users', usersApi.list, userLabel, enabled)
