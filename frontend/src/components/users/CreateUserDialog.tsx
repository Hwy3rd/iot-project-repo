import { usersApi, type CreateUserBody } from '@/api/endpoints'
import type { UserRole } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField, TextField } from '@/components/common/form-fields'
import { labelOptions } from '@/lib/filters'
import { mutationErrorText, optionalText } from '@/lib/forms'
import { ROLE_LABEL } from '@/lib/labels'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  username: string
  password: string
  fullName: string
  email: string
  phone: string
  role: string
}

const EMPTY: FormValues = {
  username: '',
  password: '',
  fullName: '',
  email: '',
  phone: '',
  role: '',
}

// Loose on purpose; the backend's @IsEmail() has the final say.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Admin only. Per-warehouse roles are assigned separately, from the warehouse. */
export function CreateUserDialog() {
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
    mutationFn: (body: CreateUserBody) => usersApi.create(body),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Đã tạo tài khoản', { description: u.username })
      setOpen(false)
      reset(EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Tên đăng nhập hoặc email đã được dùng.',
        }),
      }),
  })

  const onSubmit = handleSubmit((v) =>
    create.mutate({
      username: v.username.trim(),
      password: v.password,
      role: v.role as UserRole,
      fullName: optionalText(v.fullName),
      email: optionalText(v.email),
      phone: optionalText(v.phone),
    }),
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => reset(EMPTY)}
      triggerLabel="Tạo tài khoản"
      title="Tạo tài khoản mới"
      description="Vai trò ở đây là vai trò hệ thống; quyền trong từng kho được gán riêng khi phân công vào kho."
      onSubmit={onSubmit}
      pending={create.isPending}
      submitLabel="Tạo tài khoản"
      serverError={errors.root?.server?.message}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="user-username"
          label="Tên đăng nhập"
          spellCheck={false}
          autoCapitalize="none"
          error={errors.username}
          {...register('username', {
            validate: (v) => v.trim().length >= 3 || 'Tên đăng nhập tối thiểu 3 ký tự.',
          })}
        />
        <TextField
          id="user-password"
          label="Mật khẩu"
          type="password"
          autoComplete="new-password"
          description="Tối thiểu 6 ký tự. Gửi cho người dùng qua kênh riêng."
          error={errors.password}
          {...register('password', {
            minLength: { value: 6, message: 'Mật khẩu tối thiểu 6 ký tự.' },
            required: 'Nhập mật khẩu.',
          })}
        />
        <TextField
          id="user-full-name"
          label="Họ và tên"
          autoComplete="off"
          description="Không bắt buộc."
          error={errors.fullName}
          {...register('fullName')}
        />
        <SelectField
          control={control}
          name="role"
          rules={{ required: 'Chọn vai trò.' }}
          id="user-role"
          label="Vai trò"
          options={labelOptions(ROLE_LABEL)}
        />
        <TextField
          id="user-email"
          label="Email"
          type="email"
          spellCheck={false}
          description="Không bắt buộc."
          error={errors.email}
          {...register('email', {
            validate: (v) => !v.trim() || EMAIL_PATTERN.test(v.trim()) || 'Email không hợp lệ.',
          })}
        />
        <TextField
          id="user-phone"
          label="Số điện thoại"
          type="tel"
          inputMode="tel"
          description="Không bắt buộc."
          error={errors.phone}
          {...register('phone')}
        />
      </div>
    </FormDialog>
  )
}
