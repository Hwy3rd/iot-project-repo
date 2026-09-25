import { coldRoomsApi } from '@/api/endpoints'
import type { ColdRoom } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField, TextField } from '@/components/common/form-fields'
import {
  mutationErrorText,
  nullableNumber,
  numberRule,
  optionalNumber,
  requiredText,
  toInput,
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

const toValues = (r: ColdRoom): FormValues => ({
  warehouseId: r.warehouseId,
  name: r.name,
  tempMin: toInput(r.tempMin),
  tempMax: toInput(r.tempMax),
  hysteresis: toInput(r.hysteresis),
  doorOpenMaxSeconds: toInput(r.doorOpenMaxSeconds),
  capacityPallets: toInput(r.capacityPallets),
  capacityWeightKg: toInput(r.capacityWeightKg),
  capacityVolumeM3: toInput(r.capacityVolumeM3),
})

/** Admin, or Manager of the chosen warehouse (the backend checks the latter). */
export function CreateColdRoomDialog() {
  const [open, setOpen] = useState(false)
  return <ColdRoomFormDialog open={open} onOpenChange={setOpen} />
}

/**
 * Admin, or Manager of the room's warehouse. The warehouse itself can't be
 * changed. Mount with key={`${id}:${updatedAt}`} so the form reloads fresh values.
 */
export function EditColdRoomDialog({
  room,
  open,
  onClose,
}: {
  room: ColdRoom
  open: boolean
  onClose: () => void
}) {
  return <ColdRoomFormDialog room={room} open={open} onOpenChange={(o) => !o && onClose()} />
}

function ColdRoomFormDialog({
  room,
  open,
  onOpenChange,
}: {
  /** Set = edit this room; unset = create. */
  room?: ColdRoom
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const warehouses = useWarehouseLookup()
  const initial = room ? toValues(room) : EMPTY
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initial })

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      room
        ? coldRoomsApi.update(room.id, {
            name: v.name.trim(),
            tempMin: Number(v.tempMin),
            tempMax: Number(v.tempMax),
            // Not nullable columns: blank keeps the current value.
            hysteresis: optionalNumber(v.hysteresis),
            doorOpenMaxSeconds: optionalNumber(v.doorOpenMaxSeconds),
            capacityPallets: nullableNumber(v.capacityPallets),
            capacityWeightKg: nullableNumber(v.capacityWeightKg),
            capacityVolumeM3: nullableNumber(v.capacityVolumeM3),
          })
        : coldRoomsApi.create({
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
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cold-rooms'] })
      toast.success(room ? 'Đã lưu thay đổi' : 'Đã tạo phòng lạnh', { description: r.name })
      onOpenChange(false)
      reset(room ? toValues(r) : EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Kho này đã có phòng lạnh trùng tên. Chọn tên khác.',
          403: room
            ? 'Bạn chỉ sửa được phòng lạnh trong kho mình quản lý.'
            : 'Bạn chỉ tạo được phòng lạnh trong kho mình quản lý.',
        }),
      }),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => reset(initial)}
      triggerLabel={room ? undefined : 'Tạo phòng lạnh'}
      title={room ? `Sửa phòng lạnh ${room.name}` : 'Tạo phòng lạnh mới'}
      description="Ngưỡng nhiệt độ dùng để phát cảnh báo; tên phòng là duy nhất trong mỗi kho."
      onSubmit={handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={room ? 'Lưu thay đổi' : 'Tạo phòng lạnh'}
      serverError={errors.root?.server?.message}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="warehouseId"
          rules={room ? undefined : { required: 'Chọn kho.' }}
          id="cr-warehouse"
          label="Kho"
          options={warehouses.options}
          placeholder="Chọn kho…"
          disabled={!!room}
          description={room ? 'Không đổi được kho của phòng lạnh.' : undefined}
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
          description={room ? 'Để trống = giữ nguyên.' : 'Không bắt buộc.'}
          error={errors.hysteresis}
          {...register('hysteresis', { validate: numberRule({ label: 'độ trễ' }) })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="cr-door"
          label="Cửa mở tối đa (giây)"
          inputMode="numeric"
          description={room ? 'Để trống = giữ nguyên.' : 'Để trống = 15 giây.'}
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
