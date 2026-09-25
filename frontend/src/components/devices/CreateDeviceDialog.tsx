import { devicesApi, type CreateDeviceBody } from '@/api/endpoints'
import { FormDialog } from '@/components/common/FormDialog'
import { TextField } from '@/components/common/form-fields'
import { mutationErrorText, optionalText, requiredText } from '@/lib/forms'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  uniqueId: string
  firmwareVersion: string
}

const EMPTY: FormValues = { uniqueId: '', firmwareVersion: '' }

/**
 * Admin only: registers new hardware. It starts unassigned; a technician
 * later claims it into a cold room with a claim code.
 */
export function CreateDeviceDialog() {
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
    mutationFn: (body: CreateDeviceBody) => devicesApi.create(body),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Đã đăng ký thiết bị', { description: d.uniqueId })
      setOpen(false)
      reset(EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Mã thiết bị này đã được đăng ký.',
        }),
      }),
  })

  const onSubmit = handleSubmit((v) =>
    create.mutate({
      uniqueId: v.uniqueId.trim(),
      firmwareVersion: optionalText(v.firmwareVersion),
    }),
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => reset(EMPTY)}
      triggerLabel="Đăng ký thiết bị"
      title="Đăng ký thiết bị mới"
      description="Thiết bị mới chưa thuộc phòng lạnh nào; kỹ thuật viên sẽ gán nó vào phòng lạnh bằng mã claim."
      onSubmit={onSubmit}
      pending={create.isPending}
      submitLabel="Đăng ký"
      pendingLabel="Đang đăng ký…"
      serverError={errors.root?.server?.message}
    >
      <TextField
        id="dev-unique-id"
        label="Mã thiết bị"
        placeholder="vd: ESP32-A1B2C3…"
        spellCheck={false}
        className="font-mono"
        description="Mã duy nhất in trên phần cứng (thường là MAC hoặc chip ID)."
        error={errors.uniqueId}
        {...register('uniqueId', { validate: requiredText('Nhập mã thiết bị.') })}
      />
      <TextField
        id="dev-firmware"
        label="Phiên bản firmware"
        placeholder="vd: 1.0.3…"
        spellCheck={false}
        className="font-mono"
        description="Không bắt buộc."
        error={errors.firmwareVersion}
        {...register('firmwareVersion')}
      />
    </FormDialog>
  )
}
