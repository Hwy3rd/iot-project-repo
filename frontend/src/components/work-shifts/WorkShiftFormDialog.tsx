import { warehousesApi, workShiftsApi } from '@/api/endpoints'
import type { WorkShift } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField, TextField } from '@/components/common/form-fields'
import { dayjs } from '@/lib/format'
import { mutationErrorText } from '@/lib/forms'
import { useShiftLookup, useWarehouseLookup } from '@/lib/lookups'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  warehouseId: string
  staffId: string
  shiftId: string
  workDate: string
}

const empty = (): FormValues => ({
  warehouseId: '',
  staffId: '',
  shiftId: '',
  workDate: dayjs().format('YYYY-MM-DD'),
})

const toValues = (w: WorkShift): FormValues => ({
  warehouseId: w.warehouseId,
  staffId: w.staffId,
  shiftId: w.shiftId,
  workDate: w.workDate,
})

/** Admin, or Manager of the chosen warehouse (backend-checked). */
export function CreateWorkShiftDialog() {
  const [open, setOpen] = useState(false)
  return <WorkShiftFormDialog open={open} onOpenChange={setOpen} />
}

/**
 * Admin, or Manager of the shift's warehouse. The warehouse can't be changed;
 * the scheduled times follow the new shift/date.
 * Mount with key={`${id}:${updatedAt}`} so the form reloads fresh values.
 */
export function EditWorkShiftDialog({
  workShift,
  open,
  onClose,
}: {
  workShift: WorkShift
  open: boolean
  onClose: () => void
}) {
  return (
    <WorkShiftFormDialog workShift={workShift} open={open} onOpenChange={(o) => !o && onClose()} />
  )
}

function WorkShiftFormDialog({
  workShift,
  open,
  onOpenChange,
}: {
  /** Set = edit this work shift; unset = create. */
  workShift?: WorkShift
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const warehouses = useWarehouseLookup()
  const shifts = useShiftLookup()
  const initial = () => (workShift ? toValues(workShift) : empty())
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initial() })

  // Candidates come from the warehouse's own staff list (Admin/Manager may
  // read it), not GET /users (Admin only). Only people whose role *in this
  // warehouse* is Staff can be scheduled.
  const warehouseId = useWatch({ control, name: 'warehouseId' })
  const staff = useQuery({
    queryKey: ['warehouses', warehouseId, 'staff', { limit: 100 }],
    queryFn: () => warehousesApi.staff(warehouseId, { limit: 100 }),
    enabled: open && !!warehouseId,
  })
  const staffOptions = (staff.data?.items ?? [])
    .filter((s) => s.role === 'staff')
    .map((s) => ({
      value: s.userId,
      label: s.user?.fullName
        ? `${s.user.fullName} (${s.user.username})`
        : (s.user?.username ?? s.userId),
    }))

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      workShift
        ? workShiftsApi.update(workShift.id, {
            shiftId: v.shiftId,
            staffId: v.staffId,
            workDate: v.workDate,
          })
        : workShiftsApi.create(v),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['work-shifts'] })
      toast.success(workShift ? 'Đã lưu thay đổi' : 'Đã xếp ca trực')
      onOpenChange(false)
      reset(workShift ? toValues(w) : empty())
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Nhân viên này đã có ca này trong ngày đã chọn.',
          403: workShift
            ? 'Bạn chỉ sửa được ca trực trong kho mình quản lý.'
            : 'Bạn chỉ xếp ca được trong kho mình quản lý.',
        }),
      }),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => reset(initial())}
      triggerLabel={workShift ? undefined : 'Xếp ca trực'}
      title={workShift ? 'Sửa ca trực' : 'Xếp ca trực'}
      description="Giờ bắt đầu/kết thúc lấy theo mẫu ca; mỗi nhân viên chỉ có một ca cùng loại mỗi ngày."
      onSubmit={handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={workShift ? 'Lưu thay đổi' : 'Xếp ca'}
      serverError={errors.root?.server?.message}
    >
      <SelectField
        control={control}
        name="warehouseId"
        rules={{
          required: 'Chọn kho.',
          // A different warehouse has a different staff list.
          onChange: () => setValue('staffId', ''),
        }}
        id="ws-warehouse"
        label="Kho"
        options={warehouses.options}
        disabled={!!workShift}
        description={workShift ? 'Không đổi được kho của ca trực.' : undefined}
      />
      <SelectField
        control={control}
        name="staffId"
        rules={{ required: 'Chọn nhân viên.' }}
        id="ws-staff"
        label="Nhân viên"
        options={staffOptions}
        disabled={!warehouseId || staff.isPending}
        placeholder={
          !warehouseId
            ? 'Chọn kho trước…'
            : staff.isPending
              ? 'Đang tải…'
              : staffOptions.length === 0
                ? 'Kho chưa có nhân viên nào'
                : 'Chọn…'
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="shiftId"
          rules={{ required: 'Chọn ca.' }}
          id="ws-shift"
          label="Ca"
          options={shifts.options}
        />
        <TextField
          id="ws-date"
          label="Ngày trực"
          type="date"
          error={errors.workDate}
          {...register('workDate', { required: 'Chọn ngày trực.' })}
        />
      </div>
    </FormDialog>
  )
}
