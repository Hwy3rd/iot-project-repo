import { ApiError } from '@/api/client'
import { warehousesApi, type CreateWarehouseBody } from '@/api/endpoints'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  name: string
  code: string
  address: string
}

const EMPTY: FormValues = { name: '', code: '', address: '' }

function errorMessage(err: unknown) {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'Tên kho hoặc mã kho đã được dùng. Chọn tên/mã khác.'
    if (err.status === 403) return 'Chỉ quản trị viên mới được tạo kho.'
    if (err.status === 400 && err.errors.length) return err.errors.join(' ')
    return err.message
  }
  return 'Không tạo được kho. Thử lại sau ít phút.'
}

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
    onError: (err) => setError('root.server', { message: errorMessage(err) }),
  })

  const onSubmit = handleSubmit(({ name, code, address }) =>
    create.mutate({ name: name.trim(), code: code.trim(), address: address.trim() || undefined }),
  )

  function onOpenChange(next: boolean) {
    if (create.isPending) return
    if (!next) reset(EMPTY)
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg">
          <Plus aria-hidden="true" />
          Tạo kho
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Tạo kho mới</DialogTitle>
            <DialogDescription>Tên và mã kho phải là duy nhất trong hệ thống.</DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div aria-live="polite">
              {errors.root?.server && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{errors.root.server.message}</AlertDescription>
                </Alert>
              )}
            </div>

            <Field data-invalid={!!errors.code}>
              <FieldLabel htmlFor="wh-code">Mã kho</FieldLabel>
              <Input
                id="wh-code"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                placeholder="vd: WH-HCM-01…"
                className="font-mono"
                aria-invalid={!!errors.code}
                {...register('code', {
                  validate: (v) => !!v.trim() || 'Nhập mã kho.',
                  maxLength: { value: 255, message: 'Mã kho tối đa 255 ký tự.' },
                })}
              />
              <FieldError errors={[errors.code]} />
            </Field>

            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="wh-name">Tên kho</FieldLabel>
              <Input
                id="wh-name"
                autoComplete="off"
                placeholder="vd: Kho lạnh Tân Bình…"
                aria-invalid={!!errors.name}
                {...register('name', {
                  validate: (v) => !!v.trim() || 'Nhập tên kho.',
                  maxLength: { value: 255, message: 'Tên kho tối đa 255 ký tự.' },
                })}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field data-invalid={!!errors.address}>
              <FieldLabel htmlFor="wh-address">Địa chỉ</FieldLabel>
              <Input
                id="wh-address"
                autoComplete="street-address"
                placeholder="Số nhà, đường, quận/huyện, tỉnh/thành…"
                aria-invalid={!!errors.address}
                {...register('address', {
                  maxLength: { value: 255, message: 'Địa chỉ tối đa 255 ký tự.' },
                })}
              />
              <FieldDescription>Không bắt buộc.</FieldDescription>
              <FieldError errors={[errors.address]} />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={create.isPending}>
                Huỷ
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {create.isPending ? 'Đang tạo…' : 'Tạo kho'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
