import { usersApi } from '@/api/endpoints'
import { TextField } from '@/components/common/form-fields'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { mutationErrorText } from '@/lib/forms'
import { useMutation } from '@tanstack/react-query'
import { CircleAlert, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  currentPassword: string
  newPassword: string
  confirm: string
}

const EMPTY: FormValues = { currentPassword: '', newPassword: '', confirm: '' }

/** Profile card: change your own password (the current one is required). */
export function ChangePasswordCard() {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY })

  const change = useMutation({
    mutationFn: (v: FormValues) =>
      usersApi.changeMyPassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      toast.success('Đã đổi mật khẩu', { description: 'Dùng mật khẩu mới cho lần đăng nhập sau.' })
      reset(EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        // Length and "differs from current" are checked below, so a 400
        // here means the current password didn't match.
        message: mutationErrorText(err, { 400: 'Mật khẩu hiện tại không đúng.' }),
      }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Đổi mật khẩu</CardTitle>
        <CardDescription>Phiên đăng nhập hiện tại vẫn được giữ sau khi đổi.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit((v) => change.mutate(v))} noValidate>
          <FieldGroup>
            {errors.root?.server && (
              <Alert variant="destructive" aria-live="polite">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{errors.root.server.message}</AlertDescription>
              </Alert>
            )}
            <TextField
              id="pw-current"
              label="Mật khẩu hiện tại"
              type="password"
              autoComplete="current-password"
              error={errors.currentPassword}
              {...register('currentPassword', { required: 'Nhập mật khẩu hiện tại.' })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="pw-new"
                label="Mật khẩu mới"
                type="password"
                autoComplete="new-password"
                description="Tối thiểu 6 ký tự."
                error={errors.newPassword}
                {...register('newPassword', {
                  required: 'Nhập mật khẩu mới.',
                  minLength: { value: 6, message: 'Mật khẩu tối thiểu 6 ký tự.' },
                  validate: (v, all) => v !== all.currentPassword || 'Mật khẩu mới phải khác mật khẩu hiện tại.',
                })}
              />
              <TextField
                id="pw-confirm"
                label="Nhập lại mật khẩu mới"
                type="password"
                autoComplete="new-password"
                error={errors.confirm}
                {...register('confirm', {
                  validate: (v, all) => v === all.newPassword || 'Mật khẩu nhập lại không khớp.',
                })}
              />
            </div>
            <div>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                {change.isPending ? 'Đang đổi…' : 'Đổi mật khẩu'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
