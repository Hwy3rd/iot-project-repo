import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/auth-context'
import { PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH } from '@/lib/users'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { CircleAlert, Loader2, Snowflake } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router'

interface LoginForm {
  username: string
  password: string
}

// Only allow in-app paths as redirect targets.
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

function errorMessage(err: unknown) {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sai tên đăng nhập hoặc mật khẩu. Kiểm tra lại rồi thử lại.'
    if (err.status === 403) return 'Tài khoản đã bị khoá. Liên hệ quản trị viên để mở khoá.'
    // 429 carries the server's own "try again in N minutes" text.
    return err.message
  }
  return 'Đăng nhập thất bại. Thử lại sau ít phút.'
}

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ defaultValues: { username: '', password: '' } })

  if (user) return <Navigate to={next} replace />

  const onSubmit = handleSubmit(async ({ username, password }) => {
    try {
      await login(username.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      setError('root.server', { message: errorMessage(err) })
    }
  })

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Snowflake className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Đăng nhập ColdChain</h1>
            <p className="mt-1 text-muted-foreground">Hệ thống giám sát & quản lý kho lạnh</p>
          </div>
        </div>

        <Card>
          <CardContent>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <div aria-live="polite">
                  {errors.root?.server && (
                    <Alert variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{errors.root.server.message}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <Field data-invalid={!!errors.username}>
                  <FieldLabel htmlFor="username">Tên đăng nhập</FieldLabel>
                  <Input
                    id="username"
                    autoComplete="username"
                    spellCheck={false}
                    autoCapitalize="none"
                    placeholder="vd: nguyenvana…"
                    aria-invalid={!!errors.username}
                    maxLength={USERNAME_MAX_LENGTH}
                    {...register('username', {
                      required: 'Nhập tên đăng nhập.',
                      minLength: { value: 3, message: 'Tên đăng nhập có ít nhất 3 ký tự.' },
                      maxLength: {
                        value: USERNAME_MAX_LENGTH,
                        message: `Tên đăng nhập tối đa ${USERNAME_MAX_LENGTH} ký tự.`,
                      },
                    })}
                  />
                  <FieldError errors={[errors.username]} />
                </Field>

                <Field data-invalid={!!errors.password}>
                  <FieldLabel htmlFor="password">Mật khẩu</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    aria-invalid={!!errors.password}
                    maxLength={PASSWORD_MAX_LENGTH}
                    {...register('password', {
                      required: 'Nhập mật khẩu.',
                      maxLength: {
                        value: PASSWORD_MAX_LENGTH,
                        message: `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`,
                      },
                    })}
                  />
                  <FieldError errors={[errors.password]} />
                </Field>

                <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
                  {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Chưa có tài khoản? Quản trị viên sẽ tạo tài khoản cho bạn.
        </p>
      </div>
    </main>
  )
}
