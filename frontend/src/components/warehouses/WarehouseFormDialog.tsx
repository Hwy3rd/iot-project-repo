import { warehousesApi } from '@/api/endpoints'
import type { Warehouse } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { TextField } from '@/components/common/form-fields'
import { mutationErrorText, nullableText, optionalText, requiredText, toInput } from '@/lib/forms'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  name: string
  code: string
  address: string
}

const EMPTY: FormValues = { name: '', code: '', address: '' }

const toValues = (w: Warehouse): FormValues => ({
  name: w.name,
  code: w.code,
  address: toInput(w.address),
})

/** Admin only. */
export function CreateWarehouseDialog() {
  const [open, setOpen] = useState(false)
  return <WarehouseFormDialog open={open} onOpenChange={setOpen} />
}

/** Admin only. Mount with key={`${id}:${updatedAt}`} so the form reloads fresh values. */
export function EditWarehouseDialog({
  warehouse,
  open,
  onClose,
}: {
  warehouse: Warehouse
  open: boolean
  onClose: () => void
}) {
  return (
    <WarehouseFormDialog warehouse={warehouse} open={open} onOpenChange={(o) => !o && onClose()} />
  )
}

function WarehouseFormDialog({
  warehouse,
  open,
  onOpenChange,
}: {
  /** Set = edit this warehouse; unset = create. */
  warehouse?: Warehouse
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const initial = warehouse ? toValues(warehouse) : EMPTY
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initial })

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      warehouse
        ? warehousesApi.update(warehouse.id, {
            name: v.name.trim(),
            code: v.code.trim(),
            address: nullableText(v.address),
          })
        : warehousesApi.create({
            name: v.name.trim(),
            code: v.code.trim(),
            address: optionalText(v.address),
          }),
    onSuccess: (w) => {
      // Lists, counts and the dashboard tile all key off ['warehouses', …].
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      toast.success(warehouse ? 'Đã lưu thay đổi' : 'Đã tạo kho', {
        description: `${w.code} · ${w.name}`,
      })
      onOpenChange(false)
      reset(warehouse ? toValues(w) : EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(
          err,
          {
            409: 'Tên kho hoặc mã kho đã được dùng. Chọn tên/mã khác.',
            403: warehouse
              ? 'Chỉ quản trị viên mới được sửa kho.'
              : 'Chỉ quản trị viên mới được tạo kho.',
          },
          warehouse ? 'Không lưu được kho. Thử lại sau ít phút.' : 'Không tạo được kho. Thử lại sau ít phút.',
        ),
      }),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => reset(initial)}
      triggerLabel={warehouse ? undefined : 'Tạo kho'}
      title={warehouse ? `Sửa kho ${warehouse.code}` : 'Tạo kho mới'}
      description="Tên và mã kho phải là duy nhất trong hệ thống."
      onSubmit={handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={warehouse ? 'Lưu thay đổi' : 'Tạo kho'}
      pendingLabel={warehouse ? 'Đang lưu…' : 'Đang tạo…'}
      serverError={errors.root?.server?.message}
    >
      <TextField
        id="wh-code"
        label="Mã kho"
        spellCheck={false}
        autoCapitalize="characters"
        placeholder="vd: WH-HCM-01…"
        className="font-mono"
        error={errors.code}
        {...register('code', {
          validate: requiredText('Nhập mã kho.'),
          maxLength: { value: 255, message: 'Mã kho tối đa 255 ký tự.' },
        })}
      />
      <TextField
        id="wh-name"
        label="Tên kho"
        placeholder="vd: Kho lạnh Tân Bình…"
        error={errors.name}
        {...register('name', {
          validate: requiredText('Nhập tên kho.'),
          maxLength: { value: 255, message: 'Tên kho tối đa 255 ký tự.' },
        })}
      />
      <TextField
        id="wh-address"
        label="Địa chỉ"
        autoComplete="street-address"
        placeholder="Số nhà, đường, quận/huyện, tỉnh/thành…"
        description="Không bắt buộc."
        error={errors.address}
        {...register('address', {
          maxLength: { value: 255, message: 'Địa chỉ tối đa 255 ký tự.' },
        })}
      />
    </FormDialog>
  )
}
