import { workShiftsApi } from '@/api/endpoints'
import type { WarehouseStaff, WorkShift } from '@/api/types'
import { DetailDialog, DetailList } from '@/components/common/RowDetail'
import { WorkShiftStatusBadge } from '@/components/common/StatusBadge'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Skeleton } from '@/components/ui/skeleton'
import { dayjs, formatDate, formatDateTime, formatMinutes } from '@/lib/format'
import { useQuery } from '@tanstack/react-query'
import { Mail, Phone } from 'lucide-react'
import { LateBadge } from './LateBadge'
import { ReviewActions } from './ReviewActions'

const time = (iso: string | null) => (iso ? dayjs(iso).format('HH:mm') : '—')
const HISTORY = 6

function StaffCard({ member, fallbackName }: { member: WarehouseStaff['user']; fallbackName: string }) {
  if (!member) {
    return <p className="rounded-lg border bg-muted/40 p-3 font-medium">{fallbackName}</p>
  }
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
      <UserAvatar user={member} className="size-12 text-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold break-words">{member.fullName || member.username}</p>
        <p className="text-sm text-muted-foreground" translate="no">
          @{member.username}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {member.phone ? (
            <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
              <Phone className="size-4" aria-hidden="true" />
              {member.phone}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Phone className="size-4" aria-hidden="true" />
              Chưa có số điện thoại
            </span>
          )}
          {member.email && (
            <a
              href={`mailto:${member.email}`}
              className="inline-flex min-w-0 items-center gap-1.5 break-all text-primary hover:underline"
            >
              <Mail className="size-4 shrink-0" aria-hidden="true" />
              {member.email}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/** The staff member's latest attendance in this warehouse, other than `current`. */
function RecentAttendance({
  current,
  shiftLabel,
}: {
  current: WorkShift
  shiftLabel: (id: string) => string
}) {
  const history = useQuery({
    queryKey: ['work-shifts', { warehouseId: current.warehouseId, staffId: current.staffId, limit: HISTORY + 1 }],
    queryFn: () =>
      workShiftsApi.list({ warehouseId: current.warehouseId, staffId: current.staffId, limit: HISTORY + 1 }),
  })
  const items = (history.data?.items ?? []).filter((w) => w.id !== current.id).slice(0, HISTORY)
  const late = items.filter((w) => (w.lateMinutes ?? 0) > 0).length

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        Chấm công gần đây
        {items.length > 0 && (
          <span className="font-normal text-muted-foreground">
            {' '}
            · trễ {late}/{items.length} lần
          </span>
        )}
      </h3>
      {history.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có lần chấm công nào khác tại kho này.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {items.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="tabular-nums">
                {formatDate(w.workDate)} · {shiftLabel(w.shiftId)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <LateBadge minutes={w.lateMinutes} />
                <WorkShiftStatusBadge status={w.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * One attendance request: who sent it (contact details for Admin/Manager,
 * from the warehouse's staff list), when, how late, the review, and that
 * person's recent attendance. A pending request can be reviewed from here.
 */
export function WorkShiftDetailDialog({
  workShift: w,
  open,
  onClose,
  member,
  nameOf,
  shiftLabel,
  warehouseLabel,
  reviewable,
  showStaff,
}: {
  workShift: WorkShift
  open: boolean
  onClose: () => void
  /** The requester from GET /warehouses/:id/staff; undefined when not loaded or not allowed. */
  member: WarehouseStaff['user']
  nameOf: (userId: string | null) => string
  shiftLabel: (shiftId: string) => string
  warehouseLabel: (warehouseId: string) => string
  reviewable: boolean
  /** Reviewers see the requester and their history; Staff looking at their own don't need it. */
  showStaff: boolean
}) {
  const staffName = nameOf(w.staffId)
  return (
    <DetailDialog
      open={open}
      onClose={onClose}
      title={`${shiftLabel(w.shiftId)} · ${formatDate(w.workDate)}`}
      description={warehouseLabel(w.warehouseId)}
      actions={reviewable && <ReviewActions workShift={w} staffName={staffName} />}
      wide
    >
      <div className="flex flex-col gap-5">
        {showStaff && <StaffCard member={member} fallbackName={staffName} />}
        <DetailList
          fields={[
            { label: 'Trạng thái', value: <WorkShiftStatusBadge status={w.status} /> },
            {
              label: 'Giờ ca',
              value: `${time(w.scheduledStartAt)} – ${time(w.scheduledEndAt)}`,
            },
            { label: 'Chấm công lúc', value: formatDateTime(w.checkInAt) },
            {
              label: 'Đi trễ',
              value:
                w.lateMinutes === null ? null : w.lateMinutes > 0 ? (
                  <span className="font-medium text-warning">{formatMinutes(w.lateMinutes)}</span>
                ) : (
                  <span className="text-success">Đúng giờ</span>
                ),
            },
            { label: 'Người duyệt', value: w.reviewedBy && nameOf(w.reviewedBy) },
            { label: 'Duyệt lúc', value: w.reviewedAt && formatDateTime(w.reviewedAt) },
            { label: 'Ra ca lúc', value: w.checkOutAt && formatDateTime(w.checkOutAt) },
            { label: 'Lý do từ chối', value: w.rejectReason, full: true },
          ]}
        />
        {showStaff && <RecentAttendance current={w} shiftLabel={shiftLabel} />}
      </div>
    </DetailDialog>
  )
}
