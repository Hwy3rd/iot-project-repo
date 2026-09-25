import type { Shift } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { PageHeader } from '@/components/common/PageHeader'
import { DetailDialog, DetailList, RowActions, RowActionsHead } from '@/components/common/RowDetail'
import { EmptyState } from '@/components/common/States'
import { DeleteShiftDialog } from '@/components/shifts/DeleteShiftDialog'
import { CreateShiftDialog, EditShiftDialog } from '@/components/shifts/ShiftFormDialog'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { useShiftLookup } from '@/lib/lookups'
import { dayRanges, formatMinutes, shiftDuration, shiftHours, uncoveredMinutes } from '@/lib/shift-hours'
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

const DAY_MINUTES = 24 * 60
const pct = (minutes: number) => `${(minutes / DAY_MINUTES) * 100}%`

/** The day from 00:00 to 24:00 with each template's hours on it — gaps are hours nobody can check in. */
function DayBar({ shifts }: { shifts: Shift[] }) {
  const gap = uncoveredMinutes(shifts)
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">Khung giờ trong ngày</CardTitle>
        <CardDescription>
          {gap === 0
            ? 'Các mẫu ca phủ kín 24 giờ.'
            : `Còn ${formatMinutes(gap)} không thuộc ca nào — nhân viên không chấm công được trong khoảng đó.`}
        </CardDescription>
      </CardHeader>
      <div className="px-4">
        <div className="relative h-8 overflow-hidden rounded-md bg-muted" role="img" aria-label="Khung giờ các mẫu ca trong ngày">
          {shifts.flatMap((s) =>
            dayRanges(s).map(([from, to]) => (
              <div
                key={`${s.id}-${from}`}
                className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-x border-background bg-primary/80 px-1 text-xs font-medium whitespace-nowrap text-primary-foreground"
                style={{ left: pct(from), width: pct(to - from) }}
                title={`${s.name}: ${shiftHours(s)}`}
              >
                {s.name}
              </div>
            )),
          )}
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums" aria-hidden="true">
          {['00:00', '06:00', '12:00', '18:00', '24:00'].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </Card>
  )
}

/**
 * The shift templates Staff check in against. Admin creates, edits and
 * deletes them — any number, as long as their hours don't overlap; everyone
 * else only reads. Which template a check-in lands on is decided by the time.
 */
export function ShiftsPage() {
  const { user } = useAuth()
  const isAdmin = hasRole(user?.role, ['admin'])
  const shifts = useShiftLookup()
  const rows = useRowDialogs<Shift>()
  const [deleting, setDeleting] = useState<Shift | null>(null)
  const current = rows.item

  return (
    <>
      <PageHeader
        title="Mẫu ca"
        description="Giờ bắt đầu và kết thúc của từng ca, dùng chung cho mọi kho. Nhân viên chấm công theo mẫu ca đang diễn ra."
        actions={isAdmin && <CreateShiftDialog others={shifts.items} />}
      />
      {shifts.items.length > 0 && (
        <div className="mb-4">
          <DayBar shifts={shifts.items} />
        </div>
      )}
      <Card className="py-0">
        {shifts.items.length === 0 ? (
          <EmptyState
            title="Chưa có mẫu ca nào"
            description={
              isAdmin
                ? 'Tạo mẫu ca để nhân viên có thể chấm công.'
                : 'Quản trị viên chưa tạo mẫu ca nào.'
            }
            action={isAdmin && <CreateShiftDialog others={shifts.items} />}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Ca</TableHead>
                <TableHead>Giờ</TableHead>
                <TableHead>Thời lượng</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.items.map((s) => (
                <TableRow key={s.id} {...rowOpenProps(() => rows.view(s))}>
                  <TableCell className="pl-4 font-medium">{s.name}</TableCell>
                  <TableCell className="tabular-nums">{shiftHours(s)}</TableCell>
                  <TableCell className="text-muted-foreground">{shiftDuration(s)}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      <RowActions
                        label={`mẫu ca ${s.name}`}
                        onView={() => rows.view(s)}
                        onEdit={isAdmin ? () => rows.edit(s) : undefined}
                      />
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleting(s)}
                          aria-label={`Xoá mẫu ca ${s.name}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {current && (
        <>
          <DetailDialog
            open={rows.viewing}
            onClose={rows.close}
            title={current.name}
            onEdit={isAdmin ? () => rows.edit(current) : undefined}
          >
            <DetailList
              fields={[
                { label: 'Giờ', value: shiftHours(current) },
                { label: 'Thời lượng', value: shiftDuration(current) },
                { label: 'Ngày tạo', value: formatDateTime(current.createdAt) },
                { label: 'Cập nhật lần cuối', value: formatDateTime(current.updatedAt) },
              ]}
            />
          </DetailDialog>
          {isAdmin && (
            <EditShiftDialog
              key={`${current.id}:${current.updatedAt}`}
              shift={current}
              others={shifts.items}
              open={rows.editing}
              onClose={rows.close}
            />
          )}
        </>
      )}
      {deleting && (
        <DeleteShiftDialog key={deleting.id} shift={deleting} open onClose={() => setDeleting(null)} />
      )}
    </>
  )
}
