import { shiftsApi } from '@/api/endpoints'
import type { Shift } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { TextField } from '@/components/common/form-fields'
import { mutationErrorText, requiredText } from '@/lib/forms'
import { hoursOverlap, minuteOfDay, shiftHours } from '@/lib/shift-hours'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  name: string
  startTime: string
  endTime: string
}

const EMPTY: FormValues = { name: '', startTime: '', endTime: '' }

/** <input type="time"> wants HH:mm; the API returns HH:mm:ss. */
const toValues = (s: Shift): FormValues => ({
  name: s.name,
  startTime: s.startTime.slice(0, 5),
  endTime: s.endTime.slice(0, 5),
})

/** Admin only. `others` = the existing templates, to warn about overlaps before saving. */
export function CreateShiftDialog({ others }: { others: readonly Shift[] }) {
  const [open, setOpen] = useState(false)
  return <ShiftFormDialog open={open} onOpenChange={setOpen} others={others} />
}

/** Admin only. Mount with key={`${id}:${updatedAt}`} so the form reloads fresh values. */
export function EditShiftDialog({
  shift,
  others,
  open,
  onClose,
}: {
  shift: Shift
  others: readonly Shift[]
  open: boolean
  onClose: () => void
}) {
  return (
    <ShiftFormDialog
      shift={shift}
      others={others.filter((s) => s.id !== shift.id)}
      open={open}
      onOpenChange={(o) => !o && onClose()}
    />
  )
}

function ShiftFormDialog({
  shift,
  others,
  open,
  onOpenChange,
}: {
  /** Set = edit this template; unset = create. */
  shift?: Shift
  /** Every other active template. */
  others: readonly Shift[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const initial = shift ? toValues(shift) : EMPTY
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initial })

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { name: v.name.trim(), startTime: v.startTime, endTime: v.endTime }
      return shift ? shiftsApi.update(shift.id, body) : shiftsApi.create(body)
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['shifts'] })
      toast.success(shift ? 'Đã lưu thay đổi' : 'Đã tạo mẫu ca', { description: s.name })
      onOpenChange(false)
      reset(shift ? toValues(s) : EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Tên đã được dùng hoặc giờ bị chồng với một mẫu ca khác. Danh sách vừa được làm mới.',
        }),
      }),
    onSettled: (_, err) => err && qc.invalidateQueries({ queryKey: ['shifts'] }),
  })

  const nameTaken = (name: string) => {
    const key = name.trim().toLocaleLowerCase('vi')
    return others.find((s) => s.name.toLocaleLowerCase('vi') === key)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => reset(initial)}
      triggerLabel={shift ? undefined : 'Tạo mẫu ca'}
      title={shift ? `Sửa mẫu ca ${shift.name}` : 'Tạo mẫu ca mới'}
      description="Giờ theo giờ Việt Nam; giờ kết thúc sớm hơn giờ bắt đầu nghĩa là ca qua đêm. Các mẫu ca không được chồng giờ nhau. Sửa giờ không ảnh hưởng các lượt chấm công đã có."
      onSubmit={handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={shift ? 'Lưu thay đổi' : 'Tạo mẫu ca'}
      serverError={errors.root?.server?.message}
    >
      <TextField
        id="shift-name"
        label="Tên ca"
        placeholder="vd: Ca hành chính…"
        maxLength={100}
        error={errors.name}
        {...register('name', {
          validate: {
            required: requiredText('Nhập tên ca.'),
            unique: (name) => !nameTaken(name) || 'Đã có mẫu ca trùng tên.',
          },
        })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="shift-start"
          label="Giờ bắt đầu"
          type="time"
          error={errors.startTime}
          {...register('startTime', { required: 'Chọn giờ bắt đầu.' })}
        />
        <TextField
          id="shift-end"
          label="Giờ kết thúc"
          type="time"
          error={errors.endTime}
          {...register('endTime', {
            required: 'Chọn giờ kết thúc.',
            validate: (endTime, { startTime }) => {
              if (!startTime) return true
              if (minuteOfDay(endTime) === minuteOfDay(startTime)) {
                return 'Giờ kết thúc phải khác giờ bắt đầu.'
              }
              const clash = others.find((s) => hoursOverlap(s, { startTime, endTime }))
              return !clash || `Chồng giờ với ${clash.name} (${shiftHours(clash)}).`
            },
          })}
        />
      </div>
    </FormDialog>
  )
}
