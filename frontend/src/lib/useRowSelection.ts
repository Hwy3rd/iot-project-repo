import { useState } from 'react'

export type RowSelection = ReturnType<typeof useRowSelection>

export interface SelectableRow {
  id: string
  /** Human-readable name, kept so rows selected on another page can still be named. */
  name: string
}

/**
 * Checkbox selection that survives pagination: pick rows on page 1, move to
 * page 2, pick more, then act on all of them at once.
 *
 * `rows` are the selectable rows on the current page (leave out rows that
 * can't take the action, e.g. your own account). The selection is cleared
 * whenever `resetKey` changes — pass the list's search/filter params *without*
 * the page number, so changing the result set starts over but paging doesn't.
 * The header checkbox only toggles the current page.
 */
export function useRowSelection(rows: readonly SelectableRow[], resetKey: string) {
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [key, setKey] = useState(resetKey)
  if (key !== resetKey) {
    setKey(resetKey)
    setSelected(new Map())
  }

  const onPage = rows.filter((r) => selected.has(r.id)).length
  const count = selected.size

  function update(fn: (next: Map<string, string>) => void) {
    setSelected((prev) => {
      const next = new Map(prev)
      fn(next)
      return next
    })
  }

  return {
    ids: [...selected.keys()],
    count,
    /** Selected rows that aren't on the current page. */
    offPageCount: count - onPage,
    isSelected: (id: string) => selected.has(id),
    isSelectable: (id: string) => rows.some((r) => r.id === id),
    nameOf: (id: string) => selected.get(id) ?? id,
    /** Header checkbox state, for the current page only. */
    allState:
      onPage === 0 ? false : onPage === rows.length ? true : ('indeterminate' as const),
    toggle: (id: string, on: boolean) =>
      update((next) => {
        const row = rows.find((r) => r.id === id)
        if (on && row) next.set(id, row.name)
        else next.delete(id)
      }),
    toggleAll: (on: boolean) =>
      update((next) => {
        for (const r of rows) {
          if (on) next.set(r.id, r.name)
          else next.delete(r.id)
        }
      }),
    clear: () => setSelected(new Map()),
  }
}
