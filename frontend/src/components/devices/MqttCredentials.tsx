import { devicesApi } from '@/api/endpoints'
import type { Device, MqttCredentials } from '@/api/types'
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
} from '@/components/ui/dialog'
import { mutationErrorText } from '@/lib/forms'
import { useMutation } from '@tanstack/react-query'
import { CircleAlert, Copy, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

// The board's own broker account (Mosquitto Dynamic Security on the server):
// username = client id = unique_id. The password is readable only here, once
// — the broker keeps a hash — so it is shown as the config.h lines to paste.

function configLines(c: MqttCredentials) {
  return [
    `#define MQTT_USERNAME     "${c.username}"`,
    `#define MQTT_PASSWORD     "${c.password}"`,
    `#define DEVICE_ID         "${c.clientId}"`,
  ].join('\n')
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Đã sao chép')
  } catch {
    toast.error('Không sao chép được — hãy chép tay.')
  }
}

function CredentialsView({ credentials }: { credentials: MqttCredentials }) {
  const rows: [string, string][] = [
    ['Username', credentials.username],
    ['Mật khẩu', credentials.password],
    ['Client ID', credentials.clientId],
  ]
  return (
    <div className="grid gap-3">
      <dl className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-all font-mono" translate="no">
              {value}
            </dd>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={`Sao chép ${label}`}
              onClick={() => void copy(value)}
            >
              <Copy aria-hidden="true" />
            </Button>
          </div>
        ))}
      </dl>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Dán vào firmware/cold_room_monitor/config.h</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy(configLines(credentials))}>
            <Copy aria-hidden="true" />
            Sao chép
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs" translate="no">
          {configLines(credentials)}
        </pre>
      </div>
    </div>
  )
}

const DESCRIPTION =
  'Tài khoản MQTT riêng của thiết bị. Mật khẩu chỉ hiển thị một lần; cấp mật khẩu mới sẽ vô hiệu mật khẩu cũ và ngắt kết nối thiết bị đang chạy cho tới khi nạp lại firmware.'

/** Shows credentials already in hand (the create response). */
export function MqttCredentialsResultDialog({
  uniqueId,
  credentials,
  onClose,
}: {
  uniqueId: string
  credentials: MqttCredentials | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!credentials} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Tài khoản MQTT của <span className="font-mono">{uniqueId}</span>
          </DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {credentials && <CredentialsView credentials={credentials} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Đã lưu, đóng</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Issues a new password on demand (detail dialog action). */
export function IssueMqttCredentialsDialog({
  device,
  open,
  onClose,
}: {
  device: Device
  open: boolean
  onClose: () => void
}) {
  const [credentials, setCredentials] = useState<MqttCredentials | null>(null)
  const issue = useMutation({
    mutationFn: () => devicesApi.mqttCredentials(device.id),
    onSuccess: setCredentials,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || issue.isPending) return
        onClose()
        setCredentials(null)
        issue.reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Tài khoản MQTT của <span className="font-mono">{device.uniqueId}</span>
          </DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {issue.isError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>
              {mutationErrorText(issue.error, {
                400: 'Mã thiết bị này không dùng được làm tài khoản MQTT (ký tự không hợp lệ hoặc trùng tài khoản hệ thống).',
                403: 'Bạn chỉ cấp được cho thiết bị thuộc phòng lạnh trong phạm vi của mình.',
                409: 'Thiết bị đã ngừng sử dụng.',
                503: 'Broker MQTT không quản lý tài khoản thiết bị (chế độ cloud) hoặc đang không kết nối được.',
              })}
            </AlertDescription>
          </Alert>
        )}
        {credentials && <CredentialsView credentials={credentials} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant={credentials ? 'default' : 'outline'} disabled={issue.isPending}>
              {credentials ? 'Đã lưu, đóng' : 'Huỷ'}
            </Button>
          </DialogClose>
          {!credentials && (
            <Button type="button" disabled={issue.isPending} onClick={() => issue.mutate()}>
              {issue.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Cấp mật khẩu mới
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
