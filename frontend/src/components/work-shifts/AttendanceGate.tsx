import { workShiftsApi } from '@/api/endpoints'
import type { Attendance, WorkShift } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { ErrorState, Spinner } from '@/components/common/States'
import { WorkShiftStatusBadge } from '@/components/common/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { dayjs, formatDate } from '@/lib/format'
import { mutationErrorText } from '@/lib/forms'
import { useShiftLookup } from '@/lib/lookups'
import { useNow } from '@/lib/useNow'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Clock, Loader2, LogOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

// Under ['work-shifts'], so the realtime refetch (useWorkShiftEvents) covers it.
const ATTENDANCE_KEY = ['work-shifts', 'me'] as const

// Server: SHIFT_END_GRACE_MINUTES / CHECK_IN_EARLY_MINUTES in
// server/src/libs/constants/work-shift.constant.ts.
const SHIFT_END_GRACE_MS = 5 * 60_000
const CHECK_IN_EARLY_MINUTES = 15
// Realtime pushes review results; polling only covers a dropped socket and
// the clock moving on (a shift opening for check-in).
const PENDING_POLL_MS = 10_000
const IDLE_POLL_MS = 30_000

const hhmm = (iso: string) => dayjs(iso).format('HH:mm')
const countdown = (ms: number) => {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Staff (global role) may only use the app while working a shift a Manager
 * approved: until then the page is replaced by a check-in dialog that can't
 * be dismissed. Once the shift ends they're asked to log out, and are
 * logged out (and checked out) 5 minutes later. Other roles pass through.
 */
export function AttendanceGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'staff') return children
  return <StaffAttendance>{children}</StaffAttendance>
}

function StaffAttendance({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const me = useQuery({
    queryKey: ATTENDANCE_KEY,
    queryFn: workShiftsApi.me,
    refetchInterval: (q) =>
      q.state.data?.request?.status === 'pending' ? PENDING_POLL_MS : IDLE_POLL_MS,
  })
  const active = me.data?.active ?? null

  const ending = useRef(false)
  const endSession = useCallback(
    async (shiftId?: string) => {
      if (ending.current) return
      ending.current = true
      if (shiftId) await workShiftsApi.checkOut(shiftId).catch(() => undefined)
      await logout()
      navigate('/login', { replace: true })
      toast.info('Đã đăng xuất', { description: 'Ca trực của bạn đã kết thúc.' })
    },
    [logout, navigate],
  )

  // The shift being worked stopped being active (over, checked out, or its
  // record removed): the session ends with it. Going by the server's answer
  // rather than only the local clock also covers a skewed device clock.
  const previous = useRef<WorkShift | null>(null)
  useEffect(() => {
    if (!me.isSuccess) return
    if (previous.current && !active) void endSession(previous.current.id)
    previous.current = active
  }, [active, me.isSuccess, endSession])

  if (me.isPending) return <Spinner />
  if (me.isError && !me.data) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />

  if (!active) {
    return <CheckInDialog attendance={me.data} onLogout={() => void endSession()} />
  }
  return (
    <>
      {children}
      <ShiftEndWatcher key={active.id} shift={active} onEnd={(id) => void endSession(id)} />
    </>
  )
}

function CheckInDialog({
  attendance,
  onLogout,
}: {
  attendance: Attendance
  onLogout: () => void
}) {
  const { user } = useAuth()
  const { open, request, warehouses } = attendance
  const name = user?.fullName || user?.username

  let body: ReactNode
  if (warehouses.length === 0) {
    body = (
      <Notice title="Bạn chưa được phân công vào kho nào">
        Liên hệ quản trị viên để được phân công trước khi chấm công.
      </Notice>
    )
  } else if (!open) {
    body = (
      <Notice title="Hiện không có ca nào mở chấm công">
        Bạn có thể chấm công từ {CHECK_IN_EARLY_MINUTES} phút trước giờ bắt đầu ca cho tới khi ca kết
        thúc.
      </Notice>
    )
  } else if (request?.status === 'pending') {
    body = <PendingRequest attendance={attendance} request={request} />
  } else if (request?.status === 'approved') {
    body = (
      <Notice title="Bạn đã kết thúc ca này">
        {open.name} ngày {formatDate(open.workDate)} đã được chấm công ra. Hẹn
        gặp lại ở ca sau.
      </Notice>
    )
  } else {
    body = <CheckInForm attendance={attendance} open={open} />
  }

  return (
    // Can't be closed: no close button, Esc and outside clicks do nothing.
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        // A still blur (no fade) — see DialogOverlay on why blur isn't animated.
        overlayClassName="bg-background/40 backdrop-blur-md data-open:animate-none"
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Chấm công vào ca</DialogTitle>
          <DialogDescription>
            Xin chào {name}. Bạn cần chấm công và được quản lý kho duyệt trước khi sử dụng hệ thống.
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="sm:justify-start">
          <Button type="button" variant="ghost" onClick={onLogout}>
            <LogOut aria-hidden="true" />
            Đăng xuất
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert>
      <Clock aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

/** The shift the request is for, as the server picked it. */
function ShiftSummary({
  open,
  warehouse,
  sentAt,
}: {
  open: NonNullable<Attendance['open']>
  warehouse?: ReactNode
  sentAt: string
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-muted/50 p-3">
      {warehouse && (
        <>
          <dt className="text-muted-foreground">Kho</dt>
          <dd className="min-w-0 break-words">{warehouse}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Ca</dt>
      <dd>
        {open.name} · {formatDate(open.workDate)}
      </dd>
      <dt className="text-muted-foreground">Giờ ca</dt>
      <dd className="tabular-nums">
        {hhmm(open.scheduledStartAt)} – {hhmm(open.scheduledEndAt)}
      </dd>
      <dt className="text-muted-foreground">Thời gian chấm công</dt>
      <dd className="tabular-nums">{sentAt}</dd>
    </dl>
  )
}

function CheckInForm({
  attendance,
  open,
}: {
  attendance: Attendance
  open: NonNullable<Attendance['open']>
}) {
  const qc = useQueryClient()
  const { request, warehouses } = attendance
  const now = useNow(15_000)
  // A re-sent request defaults to the warehouse of the last one.
  const [warehouseId, setWarehouseId] = useState(
    () =>
      warehouses.find((w) => w.id === request?.warehouseId)?.id ??
      (warehouses.length === 1 ? warehouses[0].id : ''),
  )
  const [error, setError] = useState<string>()

  const send = useMutation({
    mutationFn: () => workShiftsApi.checkIn(warehouseId),
    onSuccess: () => {
      setError(undefined)
      void qc.invalidateQueries({ queryKey: ATTENDANCE_KEY })
    },
    onError: (err) =>
      setError(
        mutationErrorText(err, {
          409: 'Không gửi được: ca đã thay đổi hoặc bạn đã gửi yêu cầu cho ca này. Tải lại để xem trạng thái mới.',
        }),
      ),
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!warehouseId) return setError('Chọn kho bạn làm việc.')
        send.mutate()
      }}
    >
      {request?.status === 'rejected' && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Yêu cầu trước đã bị từ chối</AlertTitle>
          <AlertDescription>
            {request.rejectReason || 'Quản lý không ghi lý do.'} Bạn có thể gửi lại.
          </AlertDescription>
        </Alert>
      )}
      <div aria-live="polite">
        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <Field>
        <FieldLabel htmlFor="checkin-warehouse">Kho làm việc</FieldLabel>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger id="checkin-warehouse" className="w-full">
            <SelectValue placeholder="Chọn kho…" />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name} ({w.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <ShiftSummary open={open} sentAt={dayjs(now).format('HH:mm, DD/MM/YYYY')} />
      <p className="text-muted-foreground">Ca và giờ được hệ thống tự điền theo thời điểm bạn gửi yêu cầu.</p>
      <Button type="submit" size="lg" disabled={send.isPending}>
        {send.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {send.isPending ? 'Đang gửi…' : 'Gửi yêu cầu chấm công'}
      </Button>
    </form>
  )
}

function PendingRequest({ attendance, request }: { attendance: Attendance; request: WorkShift }) {
  const warehouse = attendance.warehouses.find((w) => w.id === request.warehouseId)
  return (
    <div className="grid gap-4">
      <div role="status" className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        <span>Đang chờ quản lý kho duyệt…</span>
        <WorkShiftStatusBadge status="pending" />
      </div>
      {attendance.open && (
        <ShiftSummary
          open={attendance.open}
          warehouse={warehouse ? `${warehouse.name} (${warehouse.code})` : undefined}
          sentAt={request.checkInAt ? dayjs(request.checkInAt).format('HH:mm, DD/MM/YYYY') : '—'}
        />
      )}
      <p className="text-muted-foreground">Màn hình tự mở khi yêu cầu được duyệt.</p>
    </div>
  )
}

/**
 * From the end of the shift: a dialog asking to log out, which can be put
 * away to finish up, and a countdown until the automatic logout (and
 * check-out) at the end of the grace period.
 */
function ShiftEndWatcher({ shift, onEnd }: { shift: WorkShift; onEnd: (shiftId: string) => void }) {
  const shifts = useShiftLookup()
  const now = useNow(1000)
  const [dismissed, setDismissed] = useState(false)
  const end = Date.parse(shift.scheduledEndAt)
  const deadline = end + SHIFT_END_GRACE_MS
  const over = now >= end
  const expired = now >= deadline

  useEffect(() => {
    if (expired) onEnd(shift.id)
  }, [expired, onEnd, shift.id])

  if (!over) return null
  const left = countdown(deadline - now)

  return (
    <>
      <Dialog open={!dismissed} onOpenChange={(o) => !o && setDismissed(true)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ca trực đã kết thúc</DialogTitle>
            <DialogDescription>
              {shifts.label(shift.shiftId)} kết thúc lúc {hhmm(shift.scheduledEndAt)}. Vui lòng đăng xuất.
            </DialogDescription>
          </DialogHeader>
          <p>
            Hệ thống sẽ tự động đăng xuất sau{' '}
            <span className="font-semibold tabular-nums">{left}</span>.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDismissed(true)}>
              Tiếp tục thao tác
            </Button>
            <Button type="button" onClick={() => onEnd(shift.id)}>
              <LogOut aria-hidden="true" />
              Đăng xuất
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dismissed && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-lg"
        >
          <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
          <span>
            Tự động đăng xuất sau <span className="font-semibold tabular-nums">{left}</span>
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onEnd(shift.id)}>
            Đăng xuất
          </Button>
        </div>
      )}
    </>
  )
}
