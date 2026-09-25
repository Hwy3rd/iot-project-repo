import { warehousesApi, workShiftsApi, type CreateWorkShiftBody } from '@/api/endpoints'
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

/** Admin, or Manager of the chosen warehouse (backend-checked). */
export function CreateWorkShiftDialog() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const warehouses = useWarehouseLookup()
  const shifts = useShiftLookup()
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: empty() })

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

  const create = useMutation({
    mutationFn: (body: CreateWorkShiftBody) => workShiftsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-shifts'] })
      toast.success('Đã xếp ca trực')
      setOpen(false)
      reset(empty())
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Nhân viên này đã có ca này trong ngày đã chọn.',
          403: 'Bạn chỉ xếp ca được trong kho mình quản lý.',
        }),
      }),
  })

  const onSubmit = handleSubmit((v) => create.mutate(v))

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => reset(empty())}
      triggerLabel="Xếp ca trực"
      title="Xếp ca trực"
      description="Giờ bắt đầu/kết thúc lấy theo mẫu ca; mỗi nhân viên chỉ có một ca cùng loại mỗi ngày."
      onSubmit={onSubmit}
      pending={create.isPending}
      submitLabel="Xếp ca"
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
