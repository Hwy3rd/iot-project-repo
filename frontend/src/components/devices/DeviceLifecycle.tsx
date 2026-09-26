import { devicesApi } from '@/api/endpoints'
import type { ClaimCode, Device } from '@/api/types'
import { Combobox } from '@/components/common/Combobox'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateTime } from '@/lib/format'
import { mutationErrorText } from '@/lib/forms'
import { useColdRoomLookup, useWarehouseLookup } from '@/lib/lookups'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Copy, KeyRound, Loader2, MapPinned, PowerOff } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

// The device lifecycle (docs/RBAC.md "Vòng đời kỹ thuật thiết bị"), Admin or
// Technician: registered → [claim code] → provisioned → [claim into a room]
// → active … → decommissioned (one-way). A Technician only reaches devices
// already in one of their rooms; an unassigned device is Admin's to provision.

function useDeviceMutation<T>(fn: () => Promise<T>, onDone: (result: T) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['devices'] })
      void qc.invalidateQueries({ queryKey: ['cold-rooms', 'status'] })
      onDone(result)
    },
  })
}

/** The lifecycle buttons that apply to this device's status, for the detail dialog footer. */
export function DeviceLifecycleActions({
  device,
  onChanged,
}: {
  device: Device
  /** Receives the updated device (to refresh the open dialog). */
  onChanged: (device: Device) => void
}) {
  const [dialog, setDialog] = useState<'code' | 'claim' | 'decommission' | null>(null)
  const close = () => setDialog(null)
  const canCode = device.status === 'registered' || device.status === 'provisioned'
  const canClaim = device.status === 'provisioned'
  const canDecommission = device.status !== 'decommissioned'

  return (
    <>
      {canCode && (
        <Button type="button" variant="outline" onClick={() => setDialog('code')}>
          <KeyRound aria-hidden="true" />
          Sinh mã kích hoạt
        </Button>
      )}
      {canClaim && (
        <Button type="button" variant="outline" onClick={() => setDialog('claim')}>
          <MapPinned aria-hidden="true" />
          Gán vào phòng
        </Button>
      )}
      {canDecommission && (
        <Button type="button" variant="outline" onClick={() => setDialog('decommission')}>
          <PowerOff aria-hidden="true" />
          Ngừng sử dụng
        </Button>
      )}
      <ClaimCodeDialog
        device={device}
        open={dialog === 'code'}
        onClose={close}
        // The response is only the code; the device is now provisioned until it expires.
        onGenerated={(code) =>
          onChanged({ ...device, status: 'provisioned', claimCodeExpiresAt: code.claimCodeExpiresAt })
        }
      />
      <ClaimDialog
        device={device}
        open={dialog === 'claim'}
        onClose={close}
        onClaimed={(d) => {
          close()
          onChanged(d)
        }}
      />
      <DecommissionDialog
        device={device}
        open={dialog === 'decommission'}
        onClose={close}
        onDone={(d) => {
          close()
          onChanged(d)
        }}
      />
    </>
  )
}

/**
 * Generates a one-time claim code and shows it — the only time it's ever
 * readable (the server keeps a hash). Generating again replaces the old one.
 */
function ClaimCodeDialog({
  device,
  open,
  onClose,
  onGenerated,
}: {
  device: Device
  open: boolean
  onClose: () => void
  onGenerated: (code: ClaimCode) => void
}) {
  const [code, setCode] = useState<ClaimCode | null>(null)
  const generate = useDeviceMutation(
    () => devicesApi.claimCode(device.id),
    (c) => {
      setCode(c)
      onGenerated(c)
    },
  )

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code.claimCode)
      toast.success('Đã sao chép mã')
    } catch {
      toast.error('Không sao chép được — hãy chép tay.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || generate.isPending) return
        onClose()
        setCode(null)
        generate.reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mã kích hoạt thiết bị</DialogTitle>
          <DialogDescription>
            Dùng mã này để gán <span className="font-mono">{device.uniqueId}</span> vào một phòng lạnh. Mã có hiệu
            lực 15 phút và chỉ hiển thị một lần; sinh mã mới sẽ thay mã cũ.
          </DialogDescription>
        </DialogHeader>
        {generate.isError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>
              {mutationErrorText(generate.error, {
                403: 'Bạn chỉ sinh được mã cho thiết bị đã thuộc phòng lạnh trong phạm vi của mình.',
                409: 'Thiết bị ở trạng thái này không sinh được mã kích hoạt.',
              })}
            </AlertDescription>
          </Alert>
        )}
        {code ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/40 p-4">
            <p className="font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums" translate="no">
              {code.claimCode}
            </p>
            <p className="text-sm text-muted-foreground">Hết hạn lúc {formatDateTime(code.claimCodeExpiresAt)}</p>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              <Copy aria-hidden="true" />
              Sao chép
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={generate.isPending}>
              {code ? 'Xong' : 'Huỷ'}
            </Button>
          </DialogClose>
          {!code && (
            <Button type="button" disabled={generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {device.claimCodeExpiresAt ? 'Sinh mã mới' : 'Sinh mã'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Claims a provisioned device into a room with its claim code. */
function ClaimDialog({
  device,
  open,
  onClose,
  onClaimed,
}: {
  device: Device
  open: boolean
  onClose: () => void
  onClaimed: (device: Device) => void
}) {
  const coldRooms = useColdRoomLookup()
  const warehouses = useWarehouseLookup()
  const [claimCode, setClaimCode] = useState('')
  const [coldRoomId, setColdRoomId] = useState(device.coldRoomId ?? '')
  const claim = useDeviceMutation(
    () => devicesApi.claim(device.id, { claimCode: claimCode.trim(), coldRoomId }),
    (d) => {
      toast.success('Đã gán thiết bị vào phòng', { description: coldRooms.label(d.coldRoomId) })
      onClaimed(d)
    },
  )
  const roomOptions = coldRooms.items.map((r) => ({
    value: r.id,
    label: r.name,
    hint: warehouses.get(r.warehouseId)?.code,
  }))
  const valid = /^\d{6}$/.test(claimCode.trim()) && !!coldRoomId

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || claim.isPending) return
        onClose()
        setClaimCode('')
        claim.reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) claim.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Gán thiết bị vào phòng lạnh</DialogTitle>
            <DialogDescription>
              Nhập mã kích hoạt 6 số của <span className="font-mono">{device.uniqueId}</span> và chọn phòng lắp đặt.
              Thiết bị chuyển sang trạng thái hoạt động.
            </DialogDescription>
          </DialogHeader>
          {claim.isError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>
                {mutationErrorText(claim.error, {
                  400: 'Mã kích hoạt sai hoặc đã hết hạn.',
                  403: 'Bạn chỉ gán được vào phòng lạnh trong phạm vi của mình.',
                  409: 'Thiết bị chưa được sinh mã kích hoạt (hoặc đã được gán).',
                })}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="claim-code">Mã kích hoạt</Label>
            <Input
              id="claim-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6 chữ số"
              className="font-mono tracking-widest"
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="claim-room">Phòng lạnh</Label>
            <Combobox
              id="claim-room"
              value={coldRoomId}
              onChange={setColdRoomId}
              options={roomOptions}
              placeholder="Chọn phòng lạnh…"
              searchPlaceholder="Tìm phòng lạnh…"
              emptyText="Không tìm thấy phòng lạnh."
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={claim.isPending}>
                Huỷ
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || claim.isPending}>
              {claim.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Gán vào phòng
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DecommissionDialog({
  device,
  open,
  onClose,
  onDone,
}: {
  device: Device
  open: boolean
  onClose: () => void
  onDone: (device: Device) => void
}) {
  const decommission = useDeviceMutation(
    () => devicesApi.decommission(device.id),
    (d) => {
      toast.success('Đã ngừng sử dụng thiết bị', { description: d.uniqueId })
      onDone(d)
    },
  )
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Ngừng sử dụng ${device.uniqueId}?`}
      description="Thiết bị không còn được giám sát và không nhận lệnh điều khiển nữa. Không thể hoàn tác thao tác này."
      confirmLabel="Ngừng sử dụng"
      destructive
      pending={decommission.isPending}
      onConfirm={() =>
        decommission.mutate(undefined, {
          onError: (err) =>
            toast.error('Không ngừng sử dụng được', { description: mutationErrorText(err) }),
        })
      }
    />
  )
}
