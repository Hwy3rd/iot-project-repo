import { productTypesApi, type CreateProductTypeBody } from '@/api/endpoints'
import type { ProductUnit } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField, TextField } from '@/components/common/form-fields'
import { labelOptions } from '@/lib/filters'
import {
  mutationErrorText,
  numberRule,
  optionalNumber,
  optionalText,
  requiredText,
} from '@/lib/forms'
import { PRODUCT_UNIT_LABEL } from '@/lib/labels'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  name: string
  category: string
  unit: string
  storageTempMin: string
  storageTempMax: string
}

const EMPTY: FormValues = {
  name: '',
  category: '',
  unit: '',
  storageTempMin: '',
  storageTempMax: '',
}

/** Admin only — product types are shared master data. */
export function CreateProductTypeDialog() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY })

  const create = useMutation({
    mutationFn: (body: CreateProductTypeBody) => productTypesApi.create(body),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['product-types'] })
      toast.success('Đã tạo loại sản phẩm', { description: p.name })
      setOpen(false)
      reset(EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Tên loại sản phẩm đã được dùng. Chọn tên khác.',
        }),
      }),
  })

  const onSubmit = handleSubmit((v) =>
    create.mutate({
      name: v.name.trim(),
      category: optionalText(v.category),
      unit: v.unit as ProductUnit,
      storageTempMin: optionalNumber(v.storageTempMin),
      storageTempMax: optionalNumber(v.storageTempMax),
    }),
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => reset(EMPTY)}
      triggerLabel="Tạo loại sản phẩm"
      title="Tạo loại sản phẩm mới"
      description="Khoảng nhiệt độ bảo quản (nếu có) được dùng để kiểm tra phòng lạnh khi nhập lô hàng."
      onSubmit={onSubmit}
      pending={create.isPending}
      submitLabel="Tạo loại sản phẩm"
      serverError={errors.root?.server?.message}
    >
      <TextField
        id="pt-name"
        label="Tên loại sản phẩm"
        placeholder="vd: Thịt bò đông lạnh…"
        error={errors.name}
        {...register('name', { validate: requiredText('Nhập tên loại sản phẩm.') })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="pt-category"
          label="Nhóm hàng"
          placeholder="vd: Thịt…"
          description="Không bắt buộc."
          error={errors.category}
          {...register('category')}
        />
        <SelectField
          control={control}
          name="unit"
          rules={{ required: 'Chọn đơn vị tính.' }}
          id="pt-unit"
          label="Đơn vị tính"
          options={labelOptions(PRODUCT_UNIT_LABEL)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="pt-temp-min"
          label="Bảo quản từ (°C)"
          inputMode="decimal"
          description="Không bắt buộc."
          error={errors.storageTempMin}
          {...register('storageTempMin', {
            validate: numberRule({ label: 'nhiệt độ bảo quản tối thiểu' }),
          })}
        />
        <TextField
          id="pt-temp-max"
          label="Đến (°C)"
          inputMode="decimal"
          description="Không bắt buộc."
          error={errors.storageTempMax}
          {...register('storageTempMax', {
            validate: (v, all) => {
              const base = numberRule({ label: 'nhiệt độ bảo quản tối đa' })(v)
              if (base !== true) return base
              const min = Number(all.storageTempMin)
              return !v.trim() || !all.storageTempMin.trim() || !Number.isFinite(min) || Number(v) >= min
                ? true
                : 'Nhiệt độ tối đa phải lớn hơn hoặc bằng tối thiểu.'
            },
            deps: ['storageTempMin'],
          })}
        />
      </div>
    </FormDialog>
  )
}
