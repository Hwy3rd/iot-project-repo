import { warehousesApi, type CreateWarehouseBody } from '@/api/endpoints'
import { FormDialog } from '@/components/common/FormDialog'
import { TextField } from '@/components/common/form-fields'
import { mutationErrorText, optionalText, requiredText } from '@/lib/forms'
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

export function CreateWarehouseDialog() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY })

  const create = useMutation({
    mutationFn: (body: CreateWarehouseBody) => warehousesApi.create(body),
    onSuccess: (w) => {
      // Lists, counts and the dashboard tile all key off ['warehouses', …].
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      toast.success('Đã tạo kho', { description: `${w.code} · ${w.name}` })
      setOpen(false)
      reset(EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(
          err,
          {
            409: 'Tên kho hoặc mã kho đã được dùng. Chọn tên/mã khác.',
            403: 'Chỉ quản trị viên mới được tạo kho.',
          },
          'Không tạo được kho. Thử lại sau ít phút.',
        ),
      }),
  })

  const onSubmit = handleSubmit(({ name, code, address }) =>
    create.mutate({ name: name.trim(), code: code.trim(), address: optionalText(address) }),
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => reset(EMPTY)}
      triggerLabel="Tạo kho"
      title="Tạo kho mới"
      description="Tên và mã kho phải là duy nhất trong hệ thống."
      onSubmit={onSubmit}
      pending={create.isPending}
      submitLabel="Tạo kho"
      pendingLabel="Đang tạo…"
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
