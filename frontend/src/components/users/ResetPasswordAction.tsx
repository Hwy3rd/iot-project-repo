import { usersApi } from '@/api/endpoints'
import type { User } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { TextField } from '@/components/common/form-fields'
import { Button } from '@/components/ui/button'
import { mutationErrorText } from '@/lib/forms'
import { displayName, newPasswordRules, PASSWORD_LENGTH_HINT, PASSWORD_MAX_LENGTH } from '@/lib/users'
import { useMutation } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  newPassword: string
  confirm: string
}

const EMPTY: FormValues = { newPassword: '', confirm: '' }

/**
 * Admin only: set a new password for another account (someone who forgot
 * theirs). Their session ends; your own password is changed from the
 * profile instead, so this isn't offered on yourself.
 */
export function ResetPasswordAction({ user, isSelf }: { user: User; isSelf: boolean }) {
  const [open, setOpen] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY })

  const save = useMutation({
    mutationFn: (v: FormValues) => usersApi.resetPassword(user.id, v.newPassword),
    onSuccess: () => {
      toast.success('Đã đặt lại mật khẩu', {
        description: `Gửi mật khẩu mới cho ${displayName(user)} qua kênh riêng.`,
      })
      setOpen(false)
      reset(EMPTY)
    },
    onError: (err) => setError('root.server', { message: mutationErrorText(err) }),
  })

  if (isSelf) return null
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <KeyRound aria-hidden="true" />
        Đặt lại mật khẩu
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        onClosed={() => reset(EMPTY)}
        title={`Đặt lại mật khẩu cho ${displayName(user)}`}
        description="Người này sẽ bị đăng xuất và phải đăng nhập lại bằng mật khẩu mới. Gửi mật khẩu cho họ qua kênh riêng."
        onSubmit={handleSubmit((v) => save.mutate(v))}
        pending={save.isPending}
        submitLabel="Đặt lại mật khẩu"
        serverError={errors.root?.server?.message}
      >
        <TextField
          id="reset-new"
          label="Mật khẩu mới"
          type="password"
          autoComplete="new-password"
          description={PASSWORD_LENGTH_HINT}
          error={errors.newPassword}
          maxLength={PASSWORD_MAX_LENGTH}
          {...register('newPassword', newPasswordRules)}
        />
        <TextField
          id="reset-confirm"
          label="Nhập lại mật khẩu mới"
          type="password"
          autoComplete="new-password"
          error={errors.confirm}
          {...register('confirm', {
            validate: (v, all) => v === all.newPassword || 'Mật khẩu nhập lại không khớp.',
          })}
        />
      </FormDialog>
    </>
  )
}
