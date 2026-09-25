import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

export const PAGE_SIZES = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 10

type Patch = Record<string, string | number | null | undefined>

function positiveInt(value: string | null) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** Writes a patch onto the params; empty values drop the key so URLs stay short. */
export function patchParams(prev: URLSearchParams, patch: Patch) {
  const next = new URLSearchParams(prev)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') next.delete(key)
    else next.set(key, String(value))
  }
  return next
}

/**
 * List-page state kept in the URL (?page, ?limit, ?q and the given filter keys)
 * so every view is deep-linkable and survives reload/back. Changing the search,
 * a filter or the page size jumps back to page 1.
 */
export function useListParams<K extends string>(filterKeys: readonly K[] = []) {
  const [params, setParams] = useSearchParams()

  const page = positiveInt(params.get('page')) ?? 1
  const rawLimit = positiveInt(params.get('limit'))
  const limit = PAGE_SIZES.find((s) => s === rawLimit) ?? DEFAULT_PAGE_SIZE
  const search = params.get('q') ?? ''

  const filterKey = filterKeys.join()
  const filters = useMemo(
    () => Object.fromEntries(filterKeys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>,
    // filterKey stands in for filterKeys so callers may pass an inline array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, filterKey],
  )
  const activeFilterCount = Object.values<string>(filters).filter(Boolean).length

  const setSearch = useCallback(
    // Typing shouldn't pile up history entries.
    (q: string) => setParams((prev) => patchParams(prev, { q, page: null }), { replace: true }),
    [setParams],
  )
  const setFilters = useCallback(
    (next: Partial<Record<K, string>>) =>
      setParams((prev) => patchParams(prev, { ...next, page: null })),
    [setParams],
  )
  const setLimit = useCallback(
    (n: number) =>
      setParams((prev) => patchParams(prev, { limit: n === DEFAULT_PAGE_SIZE ? null : n, page: null })),
    [setParams],
  )
  const setPage = useCallback(
    (n: number) => setParams((prev) => patchParams(prev, { page: n > 1 ? n : null })),
    [setParams],
  )
  const clearAll = useCallback(
    () =>
      setParams((prev) =>
        patchParams(prev, {
          q: null,
          page: null,
          ...Object.fromEntries(filterKey.split(',').map((k) => [k, null])),
        }),
      ),
    [setParams, filterKey],
  )

  return {
    page,
    limit,
    search,
    filters,
    activeFilterCount,
    isFiltered: !!search || activeFilterCount > 0,
    setSearch,
    setFilters,
    setLimit,
    setPage,
    clearAll,
  }
}

/** A URL filter value as an API param: blank = not filtered. */
export const param = (value: string) => value.trim() || undefined
