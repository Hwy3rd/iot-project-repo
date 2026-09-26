import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TableCell, TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Eye, Pencil } from 'lucide-react'
import type { ReactNode } from 'react'

// Per-row "Xem chi tiết" / "Sửa" for the list tables. A page keeps one
// useRowDialogs() (lib/useRowDialogs) and renders one DetailDialog (and, if
// editable, one edit dialog) below its table; rows open them via
// rowOpenProps() or the <RowActionsCell> buttons (<RowActions> on grid cards).

export function RowActionsHead() {
  return (
    <TableHead className="w-24 pr-4 text-right">
      <span className="sr-only">Thao tác</span>
    </TableHead>
  )
}

interface RowActionProps {
  /** Names the row for screen readers, e.g. "kho WH-HCM-01". */
  label: string
  onView: () => void
  /** Omit when the caller may not edit this row. */
  onEdit?: () => void
}

/** The "Xem chi tiết" / "Sửa" icon buttons, for a table cell or a grid card. */
export function RowActions({ label, onView, onEdit }: RowActionProps) {
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <Button variant="ghost" size="icon-lg" onClick={onView} aria-label={`Xem chi tiết ${label}`}>
        <Eye aria-hidden="true" />
      </Button>
      {onEdit && (
        <Button variant="ghost" size="icon-lg" onClick={onEdit} aria-label={`Sửa ${label}`}>
          <Pencil aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

export function RowActionsCell(props: RowActionProps) {
  return (
    <TableCell className="pr-4 text-right">
      <RowActions {...props} />
    </TableCell>
  )
}

/** Read-only view of one row, with a "Sửa" button when the caller may edit it. */
export function DetailDialog({
  open,
  onClose,
  title,
  description,
  onEdit,
  actions,
  wide,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  onEdit?: () => void
  /** Extra buttons for the row (e.g. "Tiếp nhận"), shown before "Sửa". */
  actions?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={cn('max-h-[90dvh] overflow-y-auto', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
          {/* Radix warns without a description; keep an empty one for screen readers. */}
          <DialogDescription className={cn(!description && 'sr-only')}>
            {description ?? 'Thông tin chi tiết'}
          </DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="flex-wrap">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Đóng
            </Button>
          </DialogClose>
          {actions}
          {onEdit && (
            <Button type="button" onClick={onEdit}>
              <Pencil aria-hidden="true" />
              Sửa
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface DetailField {
  label: string
  value: ReactNode
  /** Spans both columns, for long text or JSON. */
  full?: boolean
}

/** Label/value pairs; empty values show as "—". */
export function DetailList({ fields }: { fields: DetailField[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.label} className={cn('min-w-0', f.full && 'sm:col-span-2')}>
          <dt className="text-sm text-muted-foreground">{f.label}</dt>
          <dd className="mt-0.5 break-words">
            {f.value === null || f.value === undefined || f.value === '' ? '—' : f.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Pretty-printed JSON for metadata/payload/details columns. */
export function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <>—</>
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all" translate="no">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
