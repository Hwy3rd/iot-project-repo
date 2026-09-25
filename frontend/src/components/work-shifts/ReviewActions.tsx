import { workShiftsApi } from '@/api/endpoints'
import type { WorkShift } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { mutationErrorText } from '@/lib/forms'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

const REVIEW_ERRORS = {
  403: 'Bạn chỉ duyệt được chấm công ở kho mình quản lý.',
  409: 'Yêu cầu này đã được xử lý hoặc ca đã kết thúc. Danh sách sẽ được làm mới.',
}

/** Duyệt / Từ chối for one pending request — Admin, or Manager of its warehouse (backend-checked). */
export function ReviewActions({ workShift, staffName }: { workShift: WorkShift; staffName: string }) {
  const qc = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const approve = useMutation({
    mutationFn: () => workShiftsApi.approve(workShift.id),
    onSuccess: () => toast.success('Đã duyệt chấm công', { description: staffName }),
    onError: (err) => toast.error(mutationErrorText(err, REVIEW_ERRORS)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['work-shifts'] }),
  })

  return (
    <div className="flex justify-end gap-1">
      <Button
        size="sm"
        onClick={() => approve.mutate()}
        disabled={approve.isPending}
        aria-label={`Duyệt chấm công của ${staffName}`}
      >
        {approve.isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        Duyệt
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setRejecting(true)}
        disabled={approve.isPending}
        aria-label={`Từ chối chấm công của ${staffName}`}
      >
        <X aria-hidden="true" />
        Từ chối
      </Button>
      <RejectDialog
        workShift={workShift}
        staffName={staffName}
        open={rejecting}
        onOpenChange={setRejecting}
      />
    </div>
  )
}

function RejectDialog({
  workShift,
  staffName,
  open,
  onOpenChange,
}: {
  workShift: WorkShift
  staffName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const reject = useMutation({
    mutationFn: () => workShiftsApi.reject(workShift.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Đã từ chối chấm công', { description: staffName })
      onOpenChange(false)
      setReason('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['work-shifts'] }),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setReason('')
        reject.reset()
      }}
      title={`Từ chối chấm công của ${staffName}`}
      description="Nhân viên sẽ thấy lý do và có thể gửi lại yêu cầu."
      onSubmit={(e) => {
        e.preventDefault()
        reject.mutate()
      }}
      pending={reject.isPending}
      pendingLabel="Đang gửi…"
      submitLabel="Từ chối"
      serverError={reject.error ? mutationErrorText(reject.error, REVIEW_ERRORS) : undefined}
    >
      <Field>
        <FieldLabel htmlFor={`reject-${workShift.id}`}>Lý do</FieldLabel>
        <Textarea
          id={`reject-${workShift.id}`}
          value={reason}
          maxLength={255}
          onChange={(e) => setReason(e.target.value)}
          placeholder="vd: Chọn sai kho…"
        />
        <FieldDescription>Không bắt buộc.</FieldDescription>
      </Field>
    </FormDialog>
  )
}
