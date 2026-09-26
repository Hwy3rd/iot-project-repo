import { coldRoomsApi } from '@/api/endpoints'
import type { ColdRoom, ColdRoomInventory, ColdRoomInventoryItem } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { EditColdRoomDialog } from '@/components/cold-rooms/ColdRoomFormDialog'
import { PageHeader } from '@/components/common/PageHeader'
import { DetailList } from '@/components/common/RowDetail'
import { StatGrid, StatTile } from '@/components/common/StatTile'
import { EmptyState, ErrorState, Spinner } from '@/components/common/States'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
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
import { dayjs, formatDate, formatDateTime, formatNumber, formatTemp } from '@/lib/format'
import { PRODUCT_UNIT_LABEL } from '@/lib/labels'
import { useWarehouseLookup } from '@/lib/lookups'
import { rowOpenProps } from '@/lib/useRowDialogs'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Boxes, CalendarClock, CalendarX, Package, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

const batchesOf = (roomId: string, productTypeId?: string) =>
  `/batches?coldRoomId=${roomId}${productTypeId ? `&productTypeId=${productTypeId}` : ''}`

/** "còn 5 ngày" / "hết hạn hôm nay" / "quá hạn 2 ngày", relative to the server's `asOf`. */
function expiryHint(expiry: string, asOf: string) {
  const days = dayjs(expiry).diff(dayjs(asOf), 'day')
  if (days > 0) return `còn ${formatNumber(days)} ngày`
  if (days === 0) return 'hết hạn hôm nay'
  return `quá hạn ${formatNumber(-days)} ngày`
}

function StockStatus({ item, soonDays }: { item: ColdRoomInventoryItem; soonDays: number }) {
  if (item.expiredBatchCount === 0 && item.expiringSoonBatchCount === 0) {
    return <ToneBadge tone="success">Còn hạn</ToneBadge>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {item.expiredBatchCount > 0 && (
        <ToneBadge tone="danger">{formatNumber(item.expiredBatchCount)} lô quá hạn</ToneBadge>
      )}
      {item.expiringSoonBatchCount > 0 && (
        <span title={`Hết hạn trong ${soonDays} ngày tới`}>
          <ToneBadge tone="warning">{formatNumber(item.expiringSoonBatchCount)} lô sắp hết hạn</ToneBadge>
        </span>
      )}
    </div>
  )
}

function InventoryTable({ roomId, inventory }: { roomId: string; inventory: ColdRoomInventory }) {
  const navigate = useNavigate()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Loại sản phẩm</TableHead>
          <TableHead className="text-right">Nhiệt độ bảo quản</TableHead>
          <TableHead className="text-right">Số lô</TableHead>
          <TableHead className="text-right">Tổng số lượng</TableHead>
          <TableHead>Hạn gần nhất</TableHead>
          <TableHead>Tình trạng</TableHead>
          <TableHead className="pr-4 text-right">
            <span className="sr-only">Thao tác</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inventory.items.map((item) => {
          const expired = item.nearestExpiry < inventory.asOf
          return (
            <TableRow
              key={item.productTypeId}
              {...rowOpenProps(() => navigate(batchesOf(roomId, item.productTypeId)))}
            >
              <TableCell className="pl-4 min-w-48 whitespace-normal">
                <span className="font-medium">{item.productTypeName}</span>
                {item.category && (
                  <span className="block text-sm text-muted-foreground">{item.category}</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.storageTempMin === null || item.storageTempMax === null
                  ? '—'
                  : `${formatTemp(item.storageTempMin)} – ${formatTemp(item.storageTempMax)}`}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(item.batchCount)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(item.totalQuantity)} {PRODUCT_UNIT_LABEL[item.unit]}
              </TableCell>
              <TableCell className="tabular-nums">
                <time dateTime={item.nearestExpiry}>{formatDate(item.nearestExpiry)}</time>
                <span className={`block text-sm ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {expiryHint(item.nearestExpiry, inventory.asOf)}
                </span>
              </TableCell>
              <TableCell>
                <StockStatus item={item} soonDays={inventory.expiringSoonDays} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Link
                  to={batchesOf(roomId, item.productTypeId)}
                  className="whitespace-nowrap text-primary hover:underline"
                  aria-label={`Xem các lô ${item.productTypeName}`}
                >
                  Xem các lô
                </Link>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function InventorySection({ roomId }: { roomId: string }) {
  // Under 'batches' so creating/editing/removing a batch refreshes it too.
  const inventory = useQuery({
    queryKey: ['batches', 'inventory', roomId],
    queryFn: () => coldRoomsApi.inventory(roomId),
  })
  const data = inventory.data
  const sum = (pick: (i: ColdRoomInventoryItem) => number) =>
    data?.items.reduce((n, i) => n + pick(i), 0)

  return (
    <>
      <StatGrid>
        <StatTile label="Loại hàng đang lưu" value={data?.items.length} icon={Package} />
        <StatTile label="Lô hàng trong phòng" value={data?.totalBatches} icon={Boxes} to={batchesOf(roomId)} />
        <StatTile
          label={data ? `Sắp hết hạn (${data.expiringSoonDays} ngày)` : 'Sắp hết hạn'}
          value={sum((i) => i.expiringSoonBatchCount)}
          icon={CalendarClock}
          tone="text-warning bg-warning/15"
        />
        <StatTile
          label="Đã quá hạn"
          value={sum((i) => i.expiredBatchCount)}
          icon={CalendarX}
          tone="text-destructive bg-destructive/10"
        />
      </StatGrid>

      <Card className="mb-6 gap-0 pb-0">
        <CardHeader className="border-b">
          <CardTitle>
            <h2>Hàng hoá đang lưu trữ</h2>
          </CardTitle>
          <CardAction>
            <Link to={batchesOf(roomId)} className="text-primary hover:underline">
              Tất cả lô hàng
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {inventory.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : inventory.isError ? (
            <ErrorState error={inventory.error} onRetry={() => inventory.refetch()} />
          ) : inventory.data.items.length === 0 ? (
            <EmptyState
              title="Phòng chưa chứa hàng"
              description="Chưa có lô hàng nào đang được lưu trong phòng này."
            />
          ) : (
            <InventoryTable roomId={roomId} inventory={inventory.data} />
          )}
        </CardContent>
      </Card>
    </>
  )
}

function RoomInfoCard({ room }: { room: ColdRoom }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Cấu hình phòng</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DetailList
          fields={[
            {
              label: 'Ngưỡng nhiệt độ',
              value: `${formatTemp(room.tempMin)} – ${formatTemp(room.tempMax)}`,
            },
            { label: 'Độ trễ', value: formatTemp(room.hysteresis) },
            { label: 'Cửa mở tối đa', value: `${formatNumber(room.doorOpenMaxSeconds)} giây` },
            { label: 'Sức chứa (pallet)', value: formatNumber(room.capacityPallets) },
            {
              label: 'Tải trọng',
              value: room.capacityWeightKg === null ? null : `${formatNumber(room.capacityWeightKg)} kg`,
            },
            {
              label: 'Thể tích',
              value: room.capacityVolumeM3 === null ? null : `${formatNumber(room.capacityVolumeM3)} m³`,
            },
            { label: 'Ngày tạo', value: formatDateTime(room.createdAt) },
            { label: 'Cập nhật lần cuối', value: formatDateTime(room.updatedAt) },
          ]}
        />
      </CardContent>
    </Card>
  )
}

export function ColdRoomDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const canEdit = hasRole(user?.role, ['admin', 'manager'])
  // Same audience as the Lô hàng screen; Technician doesn't see stock.
  const canSeeStock = hasRole(user?.role, ['admin', 'manager', 'staff'])
  const [editing, setEditing] = useState(false)
  const warehouses = useWarehouseLookup()
  const room = useQuery({
    queryKey: ['cold-rooms', id],
    queryFn: () => coldRoomsApi.get(id),
  })

  const back = (
    <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
      <Link to="/cold-rooms">
        <ArrowLeft aria-hidden="true" />
        Phòng lạnh
      </Link>
    </Button>
  )

  if (room.isPending) return <>{back}<Spinner /></>
  if (room.isError) {
    return (
      <>
        {back}
        <ErrorState error={room.error} onRetry={() => room.refetch()} />
      </>
    )
  }

  const current = room.data
  return (
    <>
      {back}
      <PageHeader
        title={current.name}
        description={warehouses.label(current.warehouseId)}
        actions={
          canEdit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Sửa
            </Button>
          )
        }
      />

      {canSeeStock && <InventorySection roomId={current.id} />}
      <RoomInfoCard room={current} />

      {canEdit && (
        <EditColdRoomDialog
          key={`${current.id}:${current.updatedAt}`}
          room={current}
          open={editing}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}
