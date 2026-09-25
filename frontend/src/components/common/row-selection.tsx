import { Checkbox } from '@/components/ui/checkbox'
import { TableCell, TableHead } from '@/components/ui/table'
import type { RowSelection } from '@/lib/useRowSelection'

// The checkbox column: put <SelectAllHead> first in the header row and
// <SelectRowCell> first in each body row.

export function SelectAllHead({ selection, label }: { selection: RowSelection; label: string }) {
  return (
    <TableHead className="w-12 pl-4">
      <Checkbox
        checked={selection.allState}
        onCheckedChange={(v) => selection.toggleAll(v === true)}
        aria-label={label}
      />
    </TableHead>
  )
}

export function SelectRowCell({
  selection,
  id,
  label,
}: {
  selection: RowSelection
  id: string
  /** Names the row for screen readers, e.g. "Chọn kho WH-HCM-01". */
  label: string
}) {
  const selectable = selection.isSelectable(id)
  return (
    // A near-miss on the checkbox shouldn't open the row's detail dialog.
    <TableCell className="w-12 pl-4" data-row-click="ignore">
      <Checkbox
        checked={selectable && selection.isSelected(id)}
        onCheckedChange={(v) => selection.toggle(id, v === true)}
        disabled={!selectable}
        aria-label={label}
      />
    </TableCell>
  )
}
