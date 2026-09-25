import type { ColdRoomSeries } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dayjs, formatNumber, formatTemp } from '@/lib/format'
import { useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'

// One series (the room's temperature), so no legend: the heading names it.
// The avg line carries the reading; the min-max band shows the spread
// inside each bucket; threshold lines are labelled in text, and buckets that
// went out of range get a status dot (with the reason in the tooltip) —
// never color alone. Colors come from --chart-temp / --chart-limit, which are
// validated for both themes.

type Point = ColdRoomSeries['points'][number] & { ts: number; band: [number, number] | null }

// Buckets with no samples are absent from the API. Recharts would draw
// straight across them, so a null point is put into each hole: the line
// and band break there instead of pretending readings existed.
function toPoints(series: ColdRoomSeries): Point[] {
  const bucketMs = series.bucketMinutes * 60_000
  const out: Point[] = []
  for (const p of series.points) {
    const ts = new Date(p.t).getTime()
    const prev = out.at(-1)
    if (prev && ts - prev.ts > bucketMs * 1.5) {
      out.push({
        t: new Date(prev.ts + bucketMs).toISOString(),
        ts: prev.ts + bucketMs,
        avg: null,
        min: null,
        max: null,
        samples: 0,
        outOfRange: 0,
        doorOpen: 0,
        sensorFault: 0,
        band: null,
      })
    }
    out.push({ ...p, ts, band: p.min !== null && p.max !== null ? [p.min, p.max] : null })
  }
  return out
}

function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined
  if (!p || p.samples === 0) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="font-medium tabular-nums">{dayjs(p.ts).format('DD/MM HH:mm')}</p>
      {p.avg === null ? (
        <p className="text-destructive">Không có số đo hợp lệ (lỗi cảm biến)</p>
      ) : (
        <p className="tabular-nums">
          Trung bình <span className="font-semibold">{formatTemp(p.avg)}</span>
          <span className="text-muted-foreground">
            {' '}
            ({formatTemp(p.min)} – {formatTemp(p.max)})
          </span>
        </p>
      )}
      <p className="text-muted-foreground tabular-nums">{formatNumber(p.samples)} mẫu</p>
      {p.outOfRange > 0 && (
        <p className="text-destructive">{formatNumber(p.outOfRange)} mẫu vượt ngưỡng</p>
      )}
      {p.doorOpen > 0 && <p className="text-warning">Cửa mở trong {formatNumber(p.doorOpen)} mẫu</p>}
      {p.sensorFault > 0 && (
        <p className="text-destructive">{formatNumber(p.sensorFault)} mẫu lỗi cảm biến</p>
      )}
    </div>
  )
}

function OutOfRangeDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload?.outOfRange) return null
  return (
    <circle cx={cx} cy={cy} r={4.5} fill="var(--chart-limit)" stroke="var(--card)" strokeWidth={2} />
  )
}

export function TemperatureChart({ series }: { series: ColdRoomSeries }) {
  const [asTable, setAsTable] = useState(false)
  const points = toPoints(series)
  const { tempMin, tempMax } = series

  // Keep both thresholds on screen with a little air, even when every
  // reading sits well inside them.
  const values = points.flatMap((p) => (p.band ? p.band : []))
  const lo = Math.min(tempMin, ...values)
  const hi = Math.max(tempMax, ...values)
  const pad = Math.max(1, (hi - lo) * 0.15)
  const domain: [number, number] = [Math.floor(lo - pad), Math.ceil(hi + pad)]

  const from = new Date(series.from).getTime()
  const to = new Date(series.to).getTime()
  const spansDays = to - from > 12 * 60 * 60_000

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm text-muted-foreground">
          Nhiệt độ trung bình mỗi {series.bucketMinutes} phút · dải nhạt: thấp nhất – cao nhất
        </figcaption>
        <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Xem biểu đồ' : 'Xem dạng bảng'}
        </Button>
      </div>

      {points.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-muted-foreground">
          Không có dữ liệu nhiệt độ trong khoảng thời gian này.
        </p>
      ) : asTable ? (
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Thời điểm</TableHead>
                <TableHead className="text-right">Trung bình</TableHead>
                <TableHead className="text-right">Thấp – cao</TableHead>
                <TableHead className="pr-3 text-right">Ghi chú</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...points].filter((p) => p.samples > 0).reverse().map((p) => (
                <TableRow key={p.t}>
                  <TableCell className="pl-3 tabular-nums">{dayjs(p.ts).format('DD/MM HH:mm')}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTemp(p.avg)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTemp(p.min)} – {formatTemp(p.max)}
                  </TableCell>
                  <TableCell className="pr-3 text-right text-muted-foreground">
                    {[
                      p.outOfRange > 0 && 'vượt ngưỡng',
                      p.doorOpen > 0 && 'cửa mở',
                      p.sensorFault > 0 && 'lỗi cảm biến',
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="h-72 w-full" role="img" aria-label="Biểu đồ nhiệt độ phòng lạnh theo thời gian">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 16, right: 56, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[from, to]}
                tickFormatter={(v: number) => dayjs(v).format(spansDays ? 'DD/MM HH:mm' : 'HH:mm')}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                minTickGap={24}
              />
              <YAxis
                domain={domain}
                tickFormatter={(v: number) => `${formatNumber(v)}°`}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                content={ChartTooltip}
                cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <ReferenceLine
                y={tempMax}
                stroke="var(--chart-limit)"
                strokeDasharray="6 4"
                strokeWidth={1.5}
                label={{ value: `Trần ${formatTemp(tempMax)}`, position: 'right', fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <ReferenceLine
                y={tempMin}
                stroke="var(--chart-limit)"
                strokeDasharray="6 4"
                strokeWidth={1.5}
                label={{ value: `Sàn ${formatTemp(tempMin)}`, position: 'right', fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <Area
                dataKey="band"
                stroke="none"
                fill="var(--chart-temp)"
                fillOpacity={0.14}
                isAnimationActive={false}
                connectNulls={false}
                activeDot={false}
              />
              <Line
                dataKey="avg"
                stroke="var(--chart-temp)"
                strokeWidth={2}
                dot={OutOfRangeDot}
                activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2, fill: 'var(--chart-temp)' }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
