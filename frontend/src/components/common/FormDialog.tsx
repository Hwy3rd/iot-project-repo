import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { cn } from '@/lib/utils'
import { CircleAlert, Loader2, Plus } from 'lucide-react'
import type { FormEventHandler, ReactNode } from 'react'

/**
 * Shell shared by the create dialogs: "+ {triggerLabel}" button, header,
 * server error banner, fields, Huỷ / submit footer. The dialog can't be
 * closed while saving, and `onClosed` runs whenever it closes so the caller
 * can reset its form.
 */
export function FormDialog({
  open,
  onOpenChange,
  onClosed,
  triggerLabel,
  title,
  description,
  onSubmit,
  pending,
  submitLabel,
  pendingLabel = 'Đang lưu…',
  serverError,
  wide,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: () => void
  triggerLabel: string
  title: string
  description?: ReactNode
  onSubmit: FormEventHandler<HTMLFormElement>
  pending: boolean
  submitLabel: string
  pendingLabel?: string
  serverError?: string
  /** Two-column forms need the extra width. */
  wide?: boolean
  children: ReactNode
}) {
  function handleOpenChange(next: boolean) {
    if (pending) return
    if (!next) onClosed?.()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg">
          <Plus aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className={cn('max-h-[90dvh] overflow-y-auto', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <FieldGroup>
            <div aria-live="polite">
              {serverError && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}
            </div>
            {children}
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Huỷ
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {pending ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
