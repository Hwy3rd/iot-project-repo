import { devicesApi } from '@/api/endpoints'
import type { Device } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { TextField } from '@/components/common/form-fields'
import { mutationErrorText, nullableText, optionalText, requiredText, toInput } from '@/lib/forms'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  uniqueId: string
  firmwareVersion: string
}

const EMPTY: FormValues = { uniqueId: '', firmwareVersion: '' }

const toValues = (d: Device): FormValues => ({
  uniqueId: d.uniqueId,
  firmwareVersion: toInput(d.firmwareVersion),
})

/**
 * Admin only: registers new hardware. It starts unassigned; a technician
 * later claims it into a cold room with a claim code.
 */
export function CreateDeviceDialog() {
  const [open, setOpen] = useState(false)
  return <DeviceFormDialog open={open} onOpenChange={setOpen} />
}

/**
 * Admin or Technician. Only the firmware version is editable: the hardware id
 * is fixed, and room/status change through claim/decommission.
 * Mount with key={`${id}:${updatedAt}`} so the form reloads fresh values.
 */
export function EditDeviceDialog({
  device,
  open,
  onClose,
}: {
  device: Device
  open: boolean
  onClose: () => void
}) {
  return <DeviceFormDialog device={device} open={open} onOpenChange={(o) => !o && onClose()} />
}

function DeviceFormDialog({
  device,
  open,
  onOpenChange,
}: {
  /** Set = edit this device; unset = create. */
  device?: Device
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const initial = device ? toValues(device) : EMPTY
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initial })

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      device
        ? devicesApi.update(device.id, { firmwareVersion: nullableText(v.firmwareVersion) })
        : devicesApi.create({
            uniqueId: v.uniqueId.trim(),
            firmwareVersion: optionalText(v.firmwareVersion),
          }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success(device ? 'Đã lưu thay đổi' : 'Đã đăng ký thiết bị', { description: d.uniqueId })
      onOpenChange(false)
      reset(device ? toValues(d) : EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Mã thiết bị này đã được đăng ký.',
        }),
      }),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => reset(initial)}
      triggerLabel={device ? undefined : 'Đăng ký thiết bị'}
      title={device ? 'Sửa thiết bị' : 'Đăng ký thiết bị mới'}
      description={
        device
          ? 'Mã thiết bị gắn với phần cứng nên không đổi được; phòng lạnh và trạng thái thay đổi qua thao tác gán/ngừng sử dụng.'
          : 'Thiết bị mới chưa thuộc phòng lạnh nào; kỹ thuật viên sẽ gán nó vào phòng lạnh bằng mã claim.'
      }
      onSubmit={handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={device ? 'Lưu thay đổi' : 'Đăng ký'}
      pendingLabel={device ? 'Đang lưu…' : 'Đang đăng ký…'}
      serverError={errors.root?.server?.message}
    >
      <TextField
        id="dev-unique-id"
        label="Mã thiết bị"
        placeholder="vd: ESP32-A1B2C3…"
        spellCheck={false}
        className="font-mono"
        description={device ? undefined : 'Mã duy nhất in trên phần cứng (thường là MAC hoặc chip ID).'}
        disabled={!!device}
        error={errors.uniqueId}
        {...register('uniqueId', {
          validate: device ? undefined : requiredText('Nhập mã thiết bị.'),
        })}
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
