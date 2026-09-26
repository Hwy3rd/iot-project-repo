import type { User } from '@/api/types'
import { PageHeader } from '@/components/common/PageHeader'
import { TextField } from '@/components/common/form-fields'
import { AvatarEditor } from '@/components/profile/AvatarEditor'
import { AssignedWarehouses, ProfileInfo } from '@/components/profile/ProfileInfo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { mutationErrorText, nullableText, toInput } from '@/lib/forms'
import { ROLE_LABEL } from '@/lib/labels'
import { useProfile } from '@/lib/useProfile'
import { displayName } from '@/lib/users'
import { CircleAlert, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  fullName: string
  email: string
  phone: string
}

// Loose on purpose; the backend's @IsEmail() has the final say.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const toValues = (u: User): FormValues => ({
  fullName: toInput(u.fullName),
  email: toInput(u.email),
  phone: toInput(u.phone),
})

/** Your own account: avatar, contact details, role and warehouses. */
export function ProfilePage() {
  const { user } = useProfile()
  if (!user) return null
  return (
    <>
      <PageHeader title="Hồ sơ cá nhân" description="Thông tin tài khoản và ảnh đại diện của bạn." />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <AvatarEditor />
            <div className="min-w-0">
              <p className="text-lg font-semibold break-words">{displayName(user)}</p>
              <p className="text-muted-foreground" translate="no">
                @{user.username}
              </p>
              <p className="mt-1 text-sm">{ROLE_LABEL[user.role]}</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Remount with fresh values after each save. */}
          <ContactForm key={user.updatedAt} user={user} />
          <Card>
            <CardHeader>
              <CardTitle>Tài khoản</CardTitle>
              <CardDescription>
                Tên đăng nhập, vai trò và trạng thái do quản trị viên quản lý.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <ProfileInfo user={user} />
              <div className="flex flex-col gap-2 border-t pt-4">
                <h3 className="text-sm text-muted-foreground">Kho phụ trách</h3>
                <AssignedWarehouses user={user} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

function ContactForm({ user }: { user: User }) {
  const { update } = useProfile()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ defaultValues: toValues(user) })

  const onSubmit = handleSubmit((v) =>
    update.mutate(
      { fullName: nullableText(v.fullName), email: nullableText(v.email), phone: nullableText(v.phone) },
      {
        onSuccess: () => toast.success('Đã lưu hồ sơ'),
        onError: (err) =>
          setError('root.server', {
            message: mutationErrorText(err, { 409: 'Email này đã được tài khoản khác dùng.' }),
          }),
      },
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin liên hệ</CardTitle>
        <CardDescription>Dùng để đồng nghiệp và quản trị viên liên hệ với bạn.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div aria-live="polite">
            {errors.root?.server && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{errors.root.server.message}</AlertDescription>
              </Alert>
            )}
          </div>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField
                id="profile-full-name"
                label="Họ và tên"
                autoComplete="name"
                error={errors.fullName}
                {...register('fullName', {
                  maxLength: { value: 255, message: 'Họ và tên tối đa 255 ký tự.' },
                })}
              />
            </div>
            <TextField
              id="profile-email"
              label="Email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              error={errors.email}
              {...register('email', {
                validate: (v) => !v.trim() || EMAIL_PATTERN.test(v.trim()) || 'Email không hợp lệ.',
              })}
            />
            <TextField
              id="profile-phone"
              label="Số điện thoại"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              error={errors.phone}
              {...register('phone', {
                maxLength: { value: 255, message: 'Số điện thoại tối đa 255 ký tự.' },
              })}
            />
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || update.isPending}
              onClick={() => reset(toValues(user))}
            >
              Hoàn tác
            </Button>
            <Button type="submit" disabled={!isDirty || update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
