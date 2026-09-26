import { warehousesApi, workShiftsApi } from '@/api/endpoints'
import type { Shift, WorkShift } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { DatePicker } from '@/components/common/date-time-pickers'
import { PageHeader } from '@/components/common/PageHeader'
import { LateBadge } from '@/components/work-shifts/LateBadge'
import { WorkShiftDetailDialog } from '@/components/work-shifts/WorkShiftDetailDialog'
import { PickWarehouse } from '@/components/common/PickWarehouse'
import { RowActions } from '@/components/common/RowDetail'
import { EmptyState, ErrorState } from '@/components/common/States'
import { ToneBadge, WorkShiftStatusBadge } from '@/components/common/StatusBadge'
import { ReviewActions } from '@/components/work-shifts/ReviewActions'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dayjs, formatDate, formatNumber } from '@/lib/format'
import { shortId, useShiftLookup, useUserLookup, useWarehouseLookup } from '@/lib/lookups'
import { patchParams } from '@/lib/useListParams'
import { useNow } from '@/lib/useNow'
import { useCurrentWarehouse } from '@/lib/useCurrentWarehouse'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useSearchParams } from 'react-router'

// One warehouse's day holds a few dozen requests at most; one page covers it.
const DAY = { limit: 100 } as const
// Requests arrive over the socket (WorkShiftNotifier); this covers a dropped one.
const REFRESH_MS = 60_000

const time = (iso: string | null) => (iso ? dayjs(iso).format('HH:mm') : '—')
const today = () => dayjs().format('YYYY-MM-DD')
/** HH:mm:ss → HH:mm */
const clock = (t: string) => t.slice(0, 5)
const overnight = (s: Shift) => s.endTime <= s.startTime

interface ShiftGroup {
  key: string
  title: string
  hours?: string
  items: WorkShift[]
}

/**
 * Attendance of one warehouse on one day, one card per shift template (its
 * hours from the template), newest request first. Managers approve or
 * reject pending requests here; Staff see only their own. Warehouse and day
 * live in the URL (?warehouseId=…&date=…); the last warehouse is remembered.
 */
export function WorkShiftsPage() {
  const { user } = useAuth()
  const canReview = hasRole(user?.role, ['admin', 'manager'])
  const isAdmin = hasRole(user?.role, ['admin'])
  const [params, setParams] = useSearchParams()
  const warehouses = useWarehouseLookup()
  const shifts = useShiftLookup()
  const users = useUserLookup(isAdmin)
  const rows = useRowDialogs<WorkShift>()
  const now = useNow(30_000)

  const { warehouseId } = useCurrentWarehouse()
  const date = params.get('date') || today()
  const selectDate = (next: string) =>
    setParams((prev) => patchParams(prev, { date: next === today() ? null : next }))
  const shiftDay = (days: number) => selectDate(dayjs(date).add(days, 'day').format('YYYY-MM-DD'))

  const query = useQuery({
    queryKey: ['work-shifts', { warehouseId, workDateFrom: date, workDateTo: date, ...DAY }],
    queryFn: () =>
      workShiftsApi.list({ warehouseId, workDateFrom: date, workDateTo: date, ...DAY }),
    enabled: !!warehouseId,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  })

  // Names come from the warehouse's own member list (Admin/Manager may read
  // it), since GET /users is Admin-only; reviewers who are Admins aren't
  // members, so Admins also get the user list.
  const members = useQuery({
    queryKey: ['warehouses', warehouseId, 'staff', DAY],
    queryFn: () => warehousesApi.staff(warehouseId, DAY),
    enabled: canReview && !!warehouseId,
  })
  const memberById = new Map((members.data?.items ?? []).map((m) => [m.userId, m.user]))
  const memberNames = new Map(
    (members.data?.items ?? []).map((m) => [
      m.userId,
      m.user?.fullName ? `${m.user.fullName} (${m.user.username})` : (m.user?.username ?? shortId(m.userId)),
    ]),
  )
  const nameOf = (id: string | null) => {
    if (!id) return '—'
    if (id === user?.id) return 'Bạn'
    return memberNames.get(id) ?? users.label(id)
  }

  const items = query.data?.items ?? []
  const groups: ShiftGroup[] = shifts.items.map((s) => ({
    key: s.id,
    title: s.name,
    hours: `${clock(s.startTime)} – ${clock(s.endTime)}${overnight(s) ? ' (hôm sau)' : ''}`,
    items: items.filter((w) => w.shiftId === s.id),
  }))
  // Requests for a template deleted since.
  const orphans = items.filter((w) => !shifts.get(w.shiftId))
  if (orphans.length > 0) groups.push({ key: 'other', title: 'Mẫu ca đã xoá', items: orphans })

  // The open request as last fetched, so reviewing it from the dialog
  // (which refetches the list) updates what the dialog shows.
  const current = items.find((w) => w.id === rows.item?.id) ?? rows.item
  const isReviewable = (w: WorkShift) =>
    canReview && w.status === 'pending' && now < Date.parse(w.scheduledEndAt)
  const noWarehouses = warehouses.settled && warehouses.items.length === 0

  return (
    <>
      <PageHeader
        title="Ca trực"
        description={
          canReview
            ? 'Chấm công của nhân viên theo ca. Duyệt yêu cầu vào ca để nhân viên bắt đầu làm việc.'
            : 'Lịch sử chấm công của bạn theo ca.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-lg" onClick={() => shiftDay(-1)} aria-label="Ngày trước">
                <ChevronLeft aria-hidden="true" />
              </Button>
              <DatePicker
                value={date}
                onChange={(next) => next && selectDate(next)}
                ariaLabel="Ngày trực"
                className="h-9 w-40"
              />
              <Button variant="outline" size="icon-lg" onClick={() => shiftDay(1)} aria-label="Ngày sau">
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            {/* Always rendered (disabled on today) so the controls don't
                shift when the date changes. */}
            <Button
              variant="outline"
              size="lg"
              onClick={() => selectDate(today())}
              disabled={date === today()}
            >
              Hôm nay
            </Button>
          </div>
        }
      />

      {noWarehouses ? (
        <Card>
          <EmptyState
            title="Chưa có kho nào"
            description="Bạn cần được phân công vào ít nhất một kho để xem chấm công."
          />
        </Card>
      ) : !warehouseId && warehouses.settled ? (
        <PickWarehouse description="Chấm công được xem theo từng kho. Kho bạn chọn cũng áp dụng cho các màn khác." />
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Card>
      ) : query.isPending ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            title="Chưa có mẫu ca nào"
            description="Quản trị viên cần tạo mẫu ca trước khi nhân viên chấm công."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => {
            const pending = g.items.filter((w) => w.status === 'pending').length
            return (
              <Card key={g.key} className="gap-0 overflow-hidden pb-0">
                <CardHeader className="border-b pb-4">
                  <CardTitle className="text-base">{g.title}</CardTitle>
                  <CardDescription className="tabular-nums">
                    {g.hours ? `${g.hours} · ` : ''}
                    {formatDate(date)}
                  </CardDescription>
                  <CardAction className="flex flex-wrap justify-end gap-2">
                    {pending > 0 && <ToneBadge tone="warning">{formatNumber(pending)} chờ duyệt</ToneBadge>}
                    <ToneBadge>{formatNumber(g.items.length)} nhân viên</ToneBadge>
                  </CardAction>
                </CardHeader>
                {g.items.length === 0 ? (
                  <p className="px-4 py-6 text-center text-muted-foreground">Chưa có ai chấm công ca này.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Nhân viên</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>Chấm công</TableHead>
                        <TableHead>Người duyệt</TableHead>
                        <TableHead>Ra ca</TableHead>
                        <TableHead className="w-48 pr-4 text-right">
                          <span className="sr-only">Thao tác</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.items.map((w) => {
                        const staff = nameOf(w.staffId)
                        const reviewable = isReviewable(w)
                        return (
                          <TableRow key={w.id} {...rowOpenProps(() => rows.view(w))}>
                            <TableCell className="pl-4 font-medium">{staff}</TableCell>
                            <TableCell>
                              <WorkShiftStatusBadge status={w.status} />
                            </TableCell>
                            <TableCell className="tabular-nums">
                              <span className="flex flex-wrap items-center gap-2">
                                {time(w.checkInAt)}
                                <LateBadge minutes={w.lateMinutes} />
                              </span>
                            </TableCell>
                            <TableCell className="min-w-40 whitespace-normal">
                              {w.reviewedBy ? (
                                <>
                                  {nameOf(w.reviewedBy)}
                                  <span className="block text-muted-foreground tabular-nums">
                                    lúc {time(w.reviewedAt)}
                                  </span>
                                </>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="tabular-nums">{time(w.checkOutAt)}</TableCell>
                            <TableCell className="pr-4">
                              <div className="flex items-center justify-end gap-1">
                                {reviewable && <ReviewActions workShift={w} staffName={staff} />}
                                <RowActions label={`chấm công của ${staff}`} onView={() => rows.view(w)} />
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {current && (
        <WorkShiftDetailDialog
          workShift={current}
          open={rows.viewing}
          onClose={rows.close}
          member={memberById.get(current.staffId)}
          nameOf={nameOf}
          shiftLabel={shifts.label}
          warehouseLabel={warehouses.label}
          reviewable={isReviewable(current)}
          showStaff={canReview}
        />
      )}
    </>
  )
}
