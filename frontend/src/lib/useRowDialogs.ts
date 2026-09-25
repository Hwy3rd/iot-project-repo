import { useState, type MouseEvent } from 'react'

// State for the per-row detail/edit dialogs (components/common/RowDetail).

type Mode = 'view' | 'edit'

/**
 * Which row is open and how. `item` outlives `mode` so a dialog keeps its
 * content through the close animation.
 */
export function useRowDialogs<T>() {
  const [state, setState] = useState<{ item: T | null; mode: Mode | null }>({
    item: null,
    mode: null,
  })
  return {
    item: state.item,
    viewing: state.mode === 'view',
    editing: state.mode === 'edit',
    view: (item: T) => setState({ item, mode: 'view' }),
    edit: (item: T) => setState({ item, mode: 'edit' }),
    close: () => setState((s) => ({ ...s, mode: null })),
  }
}

/** Clicks on these inside a row do their own thing, not open the detail. */
const OWN_CLICK = 'button, a, input, label, [role="checkbox"], [data-row-click="ignore"]'

/**
 * Makes a whole table row (or grid card) open the detail dialog on click.
 * Keyboard and screen reader users get the same action from the "Xem chi
 * tiết" button in <RowActions>, so the row itself stays a plain element.
 */
export function rowOpenProps(open: () => void) {
  return {
    className: 'cursor-pointer',
    onClick: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest(OWN_CLICK)) return
      // Selecting text to copy shouldn't pop a dialog.
      if (window.getSelection()?.toString()) return
      open()
    },
  }
}
