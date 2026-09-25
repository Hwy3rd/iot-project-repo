import { coldRoomsApi, type CreateColdRoomBody } from '@/api/endpoints'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField, TextField } from '@/components/common/form-fields'
import {
  mutationErrorText,
  numberRule,
  optionalNumber,
  requiredText,
} from '@/lib/forms'
import { useWarehouseLookup } from '@/lib/lookups'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  warehouseId: string
  name: string
  tempMin: string
  tempMax: string
  hysteresis: string
  doorOpenMaxSeconds: string
  capacityPallets: string
  capacityWeightKg: string
  capacityVolumeM3: string
}

const EMPTY: FormValues = {
  warehouseId: '',
  name: '',
  tempMin: '',
  tempMax: '',
  hysteresis: '',
  doorOpenMaxSeconds: '',
  capacityPallets: '',
  capacityWeightKg: '',
  capacityVolumeM3: '',
}

/** Admin, or Manager of the chosen warehouse (the backend checks the latter). */
export function CreateColdRoomDialog() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const warehouses = useWarehouseLookup()
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY })

  const create = useMutation({
    mutationFn: (body: CreateColdRoomBody) => coldRoomsApi.create(body),
    onSuccess: (room) => {
      qc.invalidateQueries({ queryKey: ['cold-rooms'] })
      toast.success('Đã tạo phòng lạnh', { description: room.name })
      setOpen(false)
      reset(EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Kho này đã có phòng lạnh trùng tên. Chọn tên khác.',
          403: 'Bạn chỉ tạo được phòng lạnh trong kho mình quản lý.',
        }),
      }),
  })

  const onSubmit = handleSubmit((v) =>
    create.mutate({
      warehouseId: v.warehouseId,
      name: v.name.trim(),
      tempMin: Number(v.tempMin),
      tempMax: Number(v.tempMax),
      hysteresis: optionalNumber(v.hysteresis),
      doorOpenMaxSeconds: optionalNumber(v.doorOpenMaxSeconds),
      capacityPallets: optionalNumber(v.capacityPallets),
      capacityWeightKg: optionalNumber(v.capacityWeightKg),
      capacityVolumeM3: optionalNumber(v.capacityVolumeM3),
    }),
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => reset(EMPTY)}
      triggerLabel="Tạo phòng lạnh"
      title="Tạo phòng lạnh mới"
      description="Ngưỡng nhiệt độ dùng để phát cảnh báo; tên phòng là duy nhất trong mỗi kho."
      onSubmit={onSubmit}
      pending={create.isPending}
      submitLabel="Tạo phòng lạnh"
      serverError={errors.root?.server?.message}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="warehouseId"
          rules={{ required: 'Chọn kho.' }}
          id="cr-warehouse"
          label="Kho"
          options={warehouses.options}
          placeholder="Chọn kho…"
        />
        <TextField
          id="cr-name"
          label="Tên phòng"
          placeholder="vd: Phòng A1…"
          error={errors.name}
          {...register('name', { validate: requiredText('Nhập tên phòng.') })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          id="cr-temp-min"
          label="Nhiệt độ tối thiểu (°C)"
          inputMode="decimal"
          error={errors.tempMin}
          {...register('tempMin', {
            validate: numberRule({ required: true, label: 'nhiệt độ tối thiểu' }),
          })}
        />
        <TextField
          id="cr-temp-max"
          label="Nhiệt độ tối đa (°C)"
          inputMode="decimal"
          error={errors.tempMax}
          {...register('tempMax', {
            validate: (v, all) => {
              const base = numberRule({ required: true, label: 'nhiệt độ tối đa' })(v)
              if (base !== true) return base
              const min = Number(all.tempMin)
              return !all.tempMin.trim() || !Number.isFinite(min) || Number(v) > min
                ? true
                : 'Nhiệt độ tối đa phải lớn hơn tối thiểu.'
            },
            deps: ['tempMin'],
          })}
        />
        <TextField
          id="cr-hysteresis"
          label="Độ trễ (°C)"
          inputMode="decimal"
          description="Không bắt buộc."
          error={errors.hysteresis}
          {...register('hysteresis', { validate: numberRule({ label: 'độ trễ' }) })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="cr-door"
          label="Cửa mở tối đa (giây)"
          inputMode="numeric"
          description="Để trống = 15 giây."
          error={errors.doorOpenMaxSeconds}
          {...register('doorOpenMaxSeconds', {
            validate: numberRule({ integer: true, min: 0, label: 'thời gian cửa mở' }),
          })}
        />
        <TextField
          id="cr-pallets"
          label="Sức chứa (pallet)"
          inputMode="numeric"
          description="Không bắt buộc."
          error={errors.capacityPallets}
          {...register('capacityPallets', {
            validate: numberRule({ integer: true, min: 0, label: 'sức chứa' }),
          })}
        />
        <TextField
          id="cr-weight"
          label="Tải trọng (kg)"
          inputMode="decimal"
          description="Không bắt buộc."
          error={errors.capacityWeightKg}
          {...register('capacityWeightKg', {
            validate: numberRule({ min: 0, label: 'tải trọng' }),
          })}
        />
        <TextField
          id="cr-volume"
          label="Thể tích (m³)"
          inputMode="decimal"
          description="Không bắt buộc."
          error={errors.capacityVolumeM3}
          {...register('capacityVolumeM3', {
            validate: numberRule({ min: 0, label: 'thể tích' }),
          })}
        />
      </div>
    </FormDialog>
  )
}
