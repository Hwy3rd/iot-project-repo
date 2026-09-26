import { IMAGE_UPLOAD } from '@/api/endpoints'
import { imageFilesError } from '@/lib/images'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { mutationErrorText } from '@/lib/forms'
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * The images of one record (warehouse, product type…) as thumbnails; with
 * `canEdit`, adding (≤ 5 per upload, ≤ 5 MB each) and removing them.
 */
export function ImageGallery({
  images,
  canEdit,
  upload,
  remove,
  invalidate,
  onChanged,
  noun,
}: {
  images: string[] | null
  canEdit: boolean
  upload: (files: File[]) => Promise<unknown>
  remove: (url: string) => Promise<unknown>
  invalidate: QueryKey[]
  /** Receives the updated record, e.g. to refresh an open detail dialog. */
  onChanged?: (updated: unknown) => void
  /** Lower-case, e.g. "kho". */
  noun: string
}) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const list = images ?? []

  const settle = (updated: unknown) => {
    onChanged?.(updated)
    for (const key of invalidate) void qc.invalidateQueries({ queryKey: key })
  }
  const add = useMutation({
    mutationFn: upload,
    onSuccess: (updated, files) => {
      toast.success(files.length > 1 ? `Đã thêm ${files.length} ảnh` : 'Đã thêm ảnh')
      settle(updated)
    },
    onError: (err) => toast.error('Không tải ảnh lên được', { description: mutationErrorText(err) }),
  })
  const drop = useMutation({
    mutationFn: remove,
    onSuccess: (updated) => {
      toast.success('Đã xoá ảnh')
      setRemoving(null)
      settle(updated)
    },
    onError: (err) => toast.error('Không xoá được ảnh', { description: mutationErrorText(err) }),
  })

  const onPick = (files: File[]) => {
    if (files.length === 0) return
    const error = imageFilesError(files)
    if (error) {
      toast.error(error)
      return
    }
    add.mutate(files)
  }

  return (
    <section className="flex flex-col gap-2 border-t pt-4" aria-label={`Ảnh ${noun}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Hình ảnh</h3>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                onPick([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={add.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {add.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
              Thêm ảnh
            </Button>
          </>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Chưa có ảnh nào.{canEdit && ` Tối đa ${IMAGE_UPLOAD.maxFiles} ảnh mỗi lần, mỗi ảnh ≤ 5 MB.`}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((url, i) => (
            <li key={url} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
              <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Mở ảnh ${i + 1} của ${noun}`}>
                <img src={url} alt="" loading="lazy" className="size-full object-cover" />
              </a>
              {canEdit && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  className="absolute top-1 right-1 opacity-90 shadow-sm"
                  aria-label={`Xoá ảnh ${i + 1}`}
                  onClick={() => setRemoving(url)}
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Xoá ảnh này?"
        description="Ảnh sẽ bị xoá khỏi hệ thống và không khôi phục được."
        confirmLabel="Xoá ảnh"
        destructive
        pending={drop.isPending}
        onConfirm={() => removing && drop.mutate(removing)}
      />
    </section>
  )
}
