import { alertsApi, devicesApi, warehousesApi } from '@/api/endpoints'
import type { Alert } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState } from '@/components/common/States'
import { StatGrid, StatTile } from '@/components/common/StatTile'
import { AlertStatusBadge } from '@/components/common/StatusBadge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatRelative, formatTemp } from '@/lib/format'
import { ALERT_TYPE_LABEL } from '@/lib/labels'
import { useQuery } from '@tanstack/react-query'
import { Cpu, Siren, TriangleAlert, Warehouse } from 'lucide-react'
import { Link } from 'react-router'

// Only `total` is needed for the tiles, so ask for a single row.
const COUNT = { limit: 1 } as const

function RecentAlertsTable({ alerts }: { alerts: Alert[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Loại</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="text-right">Giá trị / ngưỡng</TableHead>
          <TableHead className="pr-4">Thời điểm</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alerts.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="pl-4 font-medium">{ALERT_TYPE_LABEL[a.type]}</TableCell>
            <TableCell>
              <AlertStatusBadge status={a.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {a.triggerValue === null
                ? '—'
                : `${formatTemp(a.triggerValue)} / ${formatTemp(a.threshold)}`}
            </TableCell>
            <TableCell className="pr-4 text-muted-foreground">
              <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                {formatRelative(a.createdAt)}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function DashboardPage() {
  const { user } = useAuth()

  const openAlerts = useQuery({
    queryKey: ['alerts', { status: 'open', ...COUNT }],
    queryFn: () => alertsApi.list({ status: 'open', ...COUNT }),
  })
  const ackAlerts = useQuery({
    queryKey: ['alerts', { status: 'acknowledged', ...COUNT }],
    queryFn: () => alertsApi.list({ status: 'acknowledged', ...COUNT }),
  })
  const devices = useQuery({ queryKey: ['devices', COUNT], queryFn: () => devicesApi.list(COUNT) })
  const warehouses = useQuery({
    queryKey: ['warehouses', COUNT],
    queryFn: () => warehousesApi.list(COUNT),
  })
  const recent = useQuery({
    queryKey: ['alerts', { status: 'open', limit: 10 }],
    queryFn: () => alertsApi.list({ status: 'open', limit: 10 }),
  })

  return (
    <>
      <PageHeader
        title={`Xin chào, ${user?.fullName || user?.username}`}
        description="Tình trạng các kho lạnh trong phạm vi bạn được phân công."
      />

      <StatGrid>
        <StatTile
          label="Cảnh báo đang mở"
          value={openAlerts.data?.meta.total}
          icon={Siren}
          to="/alerts?status=open"
          tone="text-destructive bg-destructive/10"
        />
        <StatTile
          label="Đã tiếp nhận, chờ xử lý"
          value={ackAlerts.data?.meta.total}
          icon={TriangleAlert}
          to="/alerts?status=acknowledged"
          tone="text-warning bg-warning/15"
        />
        <StatTile label="Thiết bị" value={devices.data?.meta.total} icon={Cpu} to="/devices" />
        <StatTile label="Kho" value={warehouses.data?.meta.total} icon={Warehouse} to="/warehouses" />
      </StatGrid>

      <Card className="gap-0 pb-0">
        <CardHeader className="border-b">
          <CardTitle>
            <h2>Cảnh báo đang mở gần đây</h2>
          </CardTitle>
          <CardAction>
            <Link to="/alerts" className="text-primary hover:underline">
              Xem tất cả
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {recent.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : recent.isError ? (
            <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
          ) : recent.data.items.length === 0 ? (
            <EmptyState
              title="Không có cảnh báo nào đang mở"
              description="Mọi phòng lạnh trong phạm vi của bạn đang ở trạng thái an toàn."
            />
          ) : (
            <RecentAlertsTable alerts={recent.data.items} />
          )}
        </CardContent>
      </Card>
    </>
  )
}
