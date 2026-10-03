import { commandsApi, devicesApi, type CreateCommandBody } from '@/api/endpoints'
import type { CommandAction } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField } from '@/components/common/form-fields'
import { labelOptions } from '@/lib/filters'
import { mutationErrorText } from '@/lib/forms'
import { CHANNEL_TYPE_LABEL, COMMAND_ACTION_LABEL } from '@/lib/labels'
import { useColdRoomLookup } from '@/lib/lookups'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  deviceId: string
  channelId: string
  action: string
}

const EMPTY: FormValues = { deviceId: '', channelId: '', action: '' }
const DEVICE_PAGE = { limit: 100 } as const

/**
 * Admin / Technician, and Staff while on an approved shift (the device list
 * and channels are then limited to the warehouse they're checked into).
 */
export function CreateCommandDialog() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const coldRooms = useColdRoomLookup()
  const {
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY })

  const devices = useQuery({
    queryKey: ['devices', DEVICE_PAGE],
    queryFn: () => devicesApi.list(DEVICE_PAGE),
    enabled: open,
  })
  // Only installed, working hardware can take a command.
  const deviceOptions = (devices.data?.items ?? [])
    .filter((d) => d.coldRoomId && d.status !== 'decommissioned')
    .map((d) => ({ value: d.id, label: `${d.uniqueId} · ${coldRooms.label(d.coldRoomId)}` }))

  const deviceId = useWatch({ control, name: 'deviceId' })
  const channels = useQuery({
    queryKey: ['devices', deviceId, 'channels'],
    queryFn: () => devicesApi.channels(deviceId),
    enabled: open && !!deviceId,
  })
  // Sensors can't be switched; the backend rejects them with 409.
  const channelOptions = (channels.data ?? [])
    .filter((c) => c.channelRole === 'actuator')
    .map((c) => ({
      value: c.id,
      label: c.label
        ? `${c.label} (${CHANNEL_TYPE_LABEL[c.channelType]})`
        : CHANNEL_TYPE_LABEL[c.channelType],
    }))

  const create = useMutation({
    mutationFn: (body: CreateCommandBody) => commandsApi.create(body),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['commands'] })
      // `pending` = the broker didn't take it yet; the server keeps retrying.
      if (c.status === 'pending') {
        toast.info('Đã tạo lệnh, đang chờ gửi tới thiết bị', {
          description: COMMAND_ACTION_LABEL[c.action],
        })
      } else {
        toast.success('Đã gửi lệnh tới thiết bị', { description: COMMAND_ACTION_LABEL[c.action] })
      }
      setOpen(false)
      reset(EMPTY)
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Kênh này không nhận lệnh điều khiển.',
          403: 'Bạn không có quyền điều khiển thiết bị này.',
        }),
      }),
  })

  const onSubmit = handleSubmit((v) =>
    create.mutate({ channelId: v.channelId, action: v.action as CommandAction }),
  )

  const channelPlaceholder = !deviceId
    ? 'Chọn thiết bị trước…'
    : channels.isPending
      ? 'Đang tải…'
      : channels.isError
        ? 'Không tải được danh sách kênh'
        : channelOptions.length === 0
          ? 'Không có kênh điều khiển'
          : 'Chọn…'
  // Sensor-only devices are common right after setup: say how to fix it
  // instead of leaving an empty dropdown.
  const noActuators = !!deviceId && channels.isSuccess && channelOptions.length === 0

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => reset(EMPTY)}
      triggerLabel="Gửi lệnh"
      title="Gửi lệnh điều khiển"
      description="Lệnh được gửi tới thiết bị qua MQTT và lưu lại kèm tên bạn. Lệnh ghi đè chế độ tự động của kênh trong 10 phút; thiết bị không nhận được trong 1 phút thì lệnh hết hạn."
      onSubmit={onSubmit}
      pending={create.isPending}
      submitLabel="Gửi lệnh"
      pendingLabel="Đang gửi…"
      serverError={errors.root?.server?.message}
    >
      <SelectField
        control={control}
        name="deviceId"
        rules={{
          required: 'Chọn thiết bị.',
          onChange: () => setValue('channelId', ''),
        }}
        id="cmd-device"
        label="Thiết bị"
        options={deviceOptions}
        placeholder={devices.isPending ? 'Đang tải…' : 'Chọn…'}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="channelId"
          rules={{ required: 'Chọn kênh.' }}
          id="cmd-channel"
          label="Kênh"
          options={channelOptions}
          disabled={!deviceId || channels.isPending || channelOptions.length === 0}
          placeholder={channelPlaceholder}
        />
        <SelectField
          control={control}
          name="action"
          rules={{ required: 'Chọn lệnh.' }}
          id="cmd-action"
          label="Lệnh"
          options={labelOptions(COMMAND_ACTION_LABEL)}
        />
      </div>
      {noActuators && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Thiết bị này chỉ có kênh cảm biến, nên chưa nhận được lệnh. Admin hoặc Kỹ thuật viên thêm
          kênh <span className="font-medium text-foreground">Quạt</span> hoặc{' '}
          <span className="font-medium text-foreground">Còi</span> ở trang Thiết bị, tab Kênh.
        </p>
      )}
    </FormDialog>
  )
}
