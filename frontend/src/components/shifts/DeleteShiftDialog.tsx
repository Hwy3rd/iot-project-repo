import { shiftsApi } from '@/api/endpoints'
import type { Shift } from '@/api/types'
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
import { mutationErrorText } from '@/lib/forms'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/** Admin only. Soft delete: past attendance records keep their times and are still listed. */
export function DeleteShiftDialog({
  shift,
  open,
  onClose,
}: {
  shift: Shift
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: () => shiftsApi.remove(shift.id),
    onSuccess: () => {
      toast.success('Đã xoá mẫu ca', { description: shift.name })
      onClose()
    },
    onError: (err) => toast.error('Không xoá được mẫu ca', { description: mutationErrorText(err) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !remove.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Xoá mẫu ca {shift.name}?</DialogTitle>
          <DialogDescription>
            Nhân viên sẽ không chấm công được vào ca này nữa, và khung giờ của nó được giải phóng cho mẫu ca
            khác. Các lượt chấm công đã có vẫn được giữ.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={remove.isPending}>
              Huỷ
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Xoá mẫu ca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
