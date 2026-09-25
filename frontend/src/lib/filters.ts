import type { Option } from '@/lib/lookups'

/** For FilterDialog's `validate`: the first inverted range's message, else null. */
export function rangeError(...ranges: [from: string, to: string, name: string][]) {
  for (const [from, to, name] of ranges) {
    if (from && to && from > to) return `${name}: “Từ ngày” phải trước hoặc bằng “Đến ngày”.`
  }
  return null
}

/** Maps a Record of labels to Select options, e.g. from lib/labels. */
export const labelOptions = (labels: Record<string, string>): Option[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))

/** A FilterDialog value with every key unfiltered. */
export const emptyFilters = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, ''])) as Record<K, string>
