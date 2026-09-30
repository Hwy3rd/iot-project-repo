import { usersApi } from '@/api/endpoints'
import type { User, UserRole } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField, TextField } from '@/components/common/form-fields'
import { AvatarEditor } from '@/components/profile/AvatarEditor'
import { labelOptions } from '@/lib/filters'
import { mutationErrorText, nullableText, optionalText, toInput } from '@/lib/forms'
import { ROLE_LABEL } from '@/lib/labels'
import { newPasswordRules, PASSWORD_LENGTH_HINT, PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH } from '@/lib/users'
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

const toValues = (u: User): FormValues => ({
  username: u.username,
  password: '',
  fullName: toInput(u.fullName),
  email: toInput(u.email),
  phone: toInput(u.phone),
  role: u.role,
})

/** Admin only. Warehouses are assigned separately, from the warehouse's detail. */
export function CreateUserDialog() {
  const [open, setOpen] = useState(false)
  return <UserFormDialog open={open} onOpenChange={setOpen} />
}

/**
 * Admin only (the Users page is): profile fields, role and avatar (saved at
 * once, apart from the form). Passwords aren't changed here.
 * Mount with key={id}; `user` should stay current (the avatar changes it).
 */
export function EditUserDialog({
  user,
  open,
  onClose,
}: {
  user: User
  open: boolean
  onClose: () => void
}) {
  return <UserFormDialog user={user} open={open} onOpenChange={(o) => !o && onClose()} />
}

function UserFormDialog({
  user,
  open,
  onOpenChange,
}: {
  /** Set = edit this user; unset = create. */
  user?: User
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const initial = user ? toValues(user) : EMPTY
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
      user
        ? usersApi.update(user.id, {
            username: v.username.trim(),
            role: v.role as UserRole,
            fullName: nullableText(v.fullName),
            email: nullableText(v.email),
            phone: nullableText(v.phone),
          })
        : usersApi.create({
            username: v.username.trim(),
            password: v.password,
            role: v.role as UserRole,
            fullName: optionalText(v.fullName),
            email: optionalText(v.email),
            phone: optionalText(v.phone),
          }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(user ? 'Đã lưu thay đổi' : 'Đã tạo tài khoản', { description: u.username })
      onOpenChange(false)
      reset(user ? toValues(u) : EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, { 409: 'Tên đăng nhập hoặc email đã được dùng.' }),
      }),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => reset(initial)}
      triggerLabel={user ? undefined : 'Tạo tài khoản'}
      title={user ? `Sửa tài khoản ${user.username}` : 'Tạo tài khoản mới'}
      description="Vai trò áp dụng ở mọi kho mà người này được phân công. Đổi sang Quản trị viên sẽ gỡ họ khỏi các kho, vì quản trị viên thấy mọi kho."
      onSubmit={handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={user ? 'Lưu thay đổi' : 'Tạo tài khoản'}
      serverError={errors.root?.server?.message}
      wide
    >
      {user && (
        <div className="flex flex-col items-center gap-1 rounded-lg border bg-muted/40 p-3">
          <AvatarEditor user={user} className="size-20 text-2xl" />
          <p className="text-xs text-muted-foreground">Ảnh đại diện được lưu ngay khi chọn, không cần bấm lưu.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="user-username"
          label="Tên đăng nhập"
          spellCheck={false}
          autoCapitalize="none"
          error={errors.username}
          maxLength={USERNAME_MAX_LENGTH}
          {...register('username', {
            validate: (v) => {
              const length = v.trim().length
              if (length < 3) return 'Tên đăng nhập tối thiểu 3 ký tự.'
              if (length > USERNAME_MAX_LENGTH) return `Tên đăng nhập tối đa ${USERNAME_MAX_LENGTH} ký tự.`
              return true
            },
          })}
        />
        {!user && (
          <TextField
            id="user-password"
            label="Mật khẩu"
            type="password"
            autoComplete="new-password"
            description={`${PASSWORD_LENGTH_HINT} Gửi cho người dùng qua kênh riêng.`}
            error={errors.password}
            maxLength={PASSWORD_MAX_LENGTH}
            {...register('password', { ...newPasswordRules, required: 'Nhập mật khẩu.' })}
          />
        )}
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
