import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { ListFilter } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

/**
 * Filter button + modal. Edits a draft copy of `value` and only commits on
 * "Áp dụng", so closing the dialog discards changes. `validate` returns an
 * error message to block applying.
 */
export function FilterDialog<T extends Record<string, string>>({
  value,
  emptyValue,
  activeCount,
  onApply,
  validate,
  title = 'Bộ lọc',
  description,
  children,
}: {
  value: T
  emptyValue: T
  activeCount: number
  onApply: (next: T) => void
  validate?: (draft: T) => string | null
  title?: string
  description?: ReactNode
  children: (draft: T, set: <K extends keyof T>(key: K, v: T[K]) => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const error = validate?.(draft) ?? null

  function onOpenChange(next: boolean) {
    if (next) setDraft(value)
    setOpen(next)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (error) return
    onApply(draft)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="shrink-0">
          <ListFilter aria-hidden="true" />
          Bộ lọc
          {activeCount > 0 && (
            <Badge className="ml-0.5 tabular-nums" aria-label={`${activeCount} bộ lọc đang bật`}>
              {activeCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FieldGroup>
            {children(draft, (key, v) => setDraft((d) => ({ ...d, [key]: v })))}
          </FieldGroup>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onApply(emptyValue)
                setOpen(false)
              }}
            >
              Xoá bộ lọc
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Huỷ
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!!error}>
                Áp dụng
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
