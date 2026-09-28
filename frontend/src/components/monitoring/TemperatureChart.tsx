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
import { Sparkles } from 'lucide-react'
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

type Point = ColdRoomSeries['points'][number] & {
  ts: number
  band: [number, number] | null
  forecast?: number | null
  isPredictionPoint?: boolean
  predictionMeta?: ColdRoomSeries['prediction']
}

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
        forecast: null,
      })
    }
    out.push({
      ...p,
      ts,
      band: p.min !== null && p.max !== null ? [p.min, p.max] : null,
      forecast: null,
    })
  }

  // If AI prediction is available and we have historical points, anchor the forecast
  if (series.prediction && out.length > 0) {
    let lastValidIdx = -1
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].avg !== null) {
        lastValidIdx = i
        break
      }
    }
    if (lastValidIdx !== -1) {
      const lastPoint = out[lastValidIdx]
      // Anchor forecast at last known measured reading so dashed line starts smoothly
      lastPoint.forecast = lastPoint.avg

      const predTs = lastPoint.ts + 15 * 60_000
      out.push({
        t: new Date(predTs).toISOString(),
        ts: predTs,
        avg: null,
        min: null,
        max: null,
        samples: 1,
        outOfRange: series.prediction.willExceedThreshold ? 1 : 0,
        doorOpen: 0,
        sensorFault: 0,
        band: null,
        forecast: series.prediction.predictedTemp15m,
        isPredictionPoint: true,
        predictionMeta: series.prediction,
      })
    }
  }

  return out
}

function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined
  if (!p) return null

  if (p.isPredictionPoint && p.predictionMeta) {
    const meta = p.predictionMeta
    return (
      <div className="rounded-lg border border-purple-500/40 bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-1.5 font-semibold text-purple-600 dark:text-purple-400">
          <Sparkles className="h-4 w-4" />
          <span>Dự báo AI (+15 phút)</span>
        </div>
        <p className="font-medium tabular-nums text-muted-foreground">{dayjs(p.ts).format('DD/MM HH:mm')}</p>
        <p className="mt-1 text-base font-bold tabular-nums">
          Dự báo: <span className="text-purple-600 dark:text-purple-400">{formatTemp(p.forecast)}</span>
        </p>
        {meta.willExceedThreshold ? (
          <p className="mt-1 text-xs font-semibold text-destructive">
            ⚠️ Nguy cơ {meta.violationType === 'OVERHEAT' ? 'quá nhiệt' : 'vượt ngưỡng sàn'} (Mức rủi ro: {meta.riskLevel})
          </p>
        ) : (
          <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            ✓ Dự báo an toàn trong ngưỡng
          </p>
        )}
        {meta.recommendation && (
          <p className="mt-1.5 border-t border-border/50 pt-1 text-xs text-muted-foreground">
            💡 {meta.recommendation}
          </p>
        )}
      </div>
    )
  }

  if (p.samples === 0) return null

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
  if (cx === undefined || cy === undefined || !payload?.outOfRange || payload?.isPredictionPoint) return null
  return (
    <circle cx={cx} cy={cy} r={4.5} fill="var(--chart-limit)" stroke="var(--card)" strokeWidth={2} />
  )
}

function PredictionDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload?.isPredictionPoint) return null
  const isWarn = payload.predictionMeta?.willExceedThreshold
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={isWarn ? '#f97316' : '#8b5cf6'} fillOpacity={0.3} />
      <circle
        cx={cx}
        cy={cy}
        r={4.5}
        fill={isWarn ? '#f97316' : '#8b5cf6'}
        stroke="var(--card)"
        strokeWidth={2}
      />
    </g>
  )
}

export function TemperatureChart({ series }: { series: ColdRoomSeries }) {
  const [asTable, setAsTable] = useState(false)
  const points = toPoints(series)
  const { tempMin, tempMax } = series

  // Keep both thresholds on screen with a little air, even when every
  // reading sits well inside them.
  const values = points.flatMap((p) => {
    const list: number[] = []
    if (p.band) list.push(...p.band)
    if (p.forecast !== undefined && p.forecast !== null) list.push(p.forecast)
    return list
  })
  const lo = Math.min(tempMin, ...values)
  const hi = Math.max(tempMax, ...values)
  const pad = Math.max(1, (hi - lo) * 0.15)
  const domain: [number, number] = [Math.floor(lo - pad), Math.ceil(hi + pad)]

  const from = new Date(series.from).getTime()
  const to = new Date(series.to).getTime()
  const maxTs = points.length > 0 ? Math.max(to, ...points.map((p) => p.ts)) : to
  const spansDays = maxTs - from > 12 * 60 * 60_000

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm text-muted-foreground flex flex-wrap items-center gap-3">
          <span>Nhiệt độ TB mỗi {series.bucketMinutes}p (dải nhạt: thấp – cao)</span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-0.5 w-3.5 rounded-full bg-[var(--chart-temp)]" /> Thực tế
          </span>
          {series.prediction && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400">
              <span className="inline-block h-0.5 w-3.5 border-b-2 border-dashed border-purple-500" /> Dự báo AI (+15p)
            </span>
          )}
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
                <TableRow key={p.t} className={p.isPredictionPoint ? 'bg-purple-50/50 dark:bg-purple-950/20 font-medium' : undefined}>
                  <TableCell className="pl-3 tabular-nums">
                    {dayjs(p.ts).format('DD/MM HH:mm')}
                    {p.isPredictionPoint && <span className="ml-1.5 text-xs text-purple-600 dark:text-purple-400">(Dự báo AI)</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.isPredictionPoint ? (
                      <span className="text-purple-600 dark:text-purple-400 font-semibold">{formatTemp(p.forecast)}</span>
                    ) : (
                      formatTemp(p.avg)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.isPredictionPoint ? '—' : `${formatTemp(p.min)} – ${formatTemp(p.max)}`}
                  </TableCell>
                  <TableCell className="pr-3 text-right text-muted-foreground">
                    {p.isPredictionPoint ? (
                      p.predictionMeta?.willExceedThreshold ? (
                        <span className="text-destructive font-medium">⚠️ Nguy cơ vượt ngưỡng</span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">✓ An toàn</span>
                      )
                    ) : (
                      [
                        p.outOfRange > 0 && 'vượt ngưỡng',
                        p.doorOpen > 0 && 'cửa mở',
                        p.sensorFault > 0 && 'lỗi cảm biến',
                      ]
                        .filter(Boolean)
                        .join(', ') || '—'
                    )}
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
                domain={[from, maxTs]}
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
              {series.prediction && (
                <Line
                  dataKey="forecast"
                  stroke={series.prediction.willExceedThreshold ? '#f97316' : '#8b5cf6'}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={PredictionDot}
                  activeDot={{
                    r: 6,
                    fill: series.prediction.willExceedThreshold ? '#f97316' : '#8b5cf6',
                    stroke: 'var(--card)',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
