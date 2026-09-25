import type { BulkDeleteResult } from '@/api/types'
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
import { mutationErrorText } from '@/lib/forms'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

// The bulk endpoints take at most 100 ids (a page's worth); a larger
// cross-page selection is sent in chunks.
const CHUNK = 100

// Row-level failures come back with the status the single DELETE would
// have answered with; the backend's messages are English, so show ours.
const FAILURE_TEXT: Record<number, string> = {
  403: 'bạn không có quyền với mục này',
  404: 'không còn tồn tại (có thể đã bị xoá)',
}

/**
 * "Xoá (N)" button + confirmation, backed by `POST /<resource>/bulk-delete`.
 * The backend deletes row by row (best effort) and reports which ids failed
 * and why; that report is shown in a toast.
 */
export function BulkDeleteDialog({
  ids,
  noun,
  bulkRemove,
  invalidate,
  onDone,
  verb = 'Xoá',
  warning,
  describe,
  failureText,
}: {
  ids: readonly string[]
  /** e.g. "kho" → "Xoá 3 kho?" */
  noun: string
  bulkRemove: (ids: string[]) => Promise<BulkDeleteResult>
  /** Query keys to refresh afterwards (lists, counts, lookups). */
  invalidate: QueryKey[]
  onDone: () => void
  /** Action word, for resources where DELETE isn't a plain delete. */
  verb?: string
  /** Extra consequence shown in the confirmation, e.g. cascades. */
  warning?: ReactNode
  /** Names a failed row in the error toast. */
  describe?: (id: string) => string
  /** Resource-specific reasons by status, e.g. 409 for batches. */
  failureText?: Partial<Record<number, string>>
}) {
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const qc = useQueryClient()
  const running = progress !== null
  const count = ids.length
  const action = verb.toLowerCase()

  async function onConfirm() {
    setProgress(0)
    const failures: { id: string; reason: string }[] = []
    let requestError: unknown = null
    for (let start = 0; start < count; start += CHUNK) {
      const chunk = ids.slice(start, start + CHUNK)
      try {
        const result = await bulkRemove(chunk)
        for (const f of result.failed) {
          failures.push({
            id: f.id,
            reason: failureText?.[f.statusCode] ?? FAILURE_TEXT[f.statusCode] ?? f.message,
          })
        }
      } catch (error) {
        // The whole request failed (network, 401/403 on the route itself):
        // none of this chunk — nor the ones after it — was attempted.
        requestError = error
        for (const id of ids.slice(start)) failures.push({ id, reason: mutationErrorText(error) })
        break
      }
      setProgress(Math.min(start + CHUNK, count))
    }
    await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })))
    setProgress(null)
    setOpen(false)
    onDone()

    const ok = count - failures.length
    if (failures.length === 0) {
      toast.success(`Đã ${action} ${count} ${noun}`)
      return
    }
    if (requestError && ok === 0) {
      toast.error(`Không ${action} được ${noun} nào`, {
        description: mutationErrorText(requestError),
      })
      return
    }
    const lines = failures.slice(0, 3).map(({ id, reason }) => `${describe?.(id) ?? id}: ${reason}`)
    if (failures.length > 3) lines.push(`… và ${failures.length - 3} ${noun} khác`)
    toast.error(
      ok > 0
        ? `Đã ${action} ${ok}/${count} ${noun}; ${failures.length} không thành công`
        : `Không ${action} được ${noun} nào`,
      {
        description: (
          <ul className="list-disc pl-4">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ),
        duration: 10_000,
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="lg">
          <Trash2 aria-hidden="true" />
          {verb} ({count})
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {verb} {count} {noun}?
          </DialogTitle>
          <DialogDescription>
            Thao tác áp dụng cho tất cả {noun} đã chọn, kể cả ở các trang khác.
          </DialogDescription>
        </DialogHeader>
        {warning && <div className="text-pretty text-muted-foreground">{warning}</div>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={running}>
              Huỷ
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={running}>
            {running && <Loader2 className="animate-spin" aria-hidden="true" />}
            {running ? `Đang xử lý ${progress}/${count}…` : `${verb} ${count} ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
