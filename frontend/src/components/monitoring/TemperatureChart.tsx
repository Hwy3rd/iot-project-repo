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
import { dayjs, formatHumidity, formatNumber, formatTemp } from '@/lib/format'
import { AI_RISK_LEVEL_LABEL, AI_VIOLATION_LABEL } from '@/lib/labels'
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

// One source for every mark's look: the chart draws with these and the
// legend renders its swatches from them, so the two can't drift apart.
const STYLE = {
  temp: 'var(--chart-temp)',
  limit: 'var(--chart-limit)',
  bandOpacity: 0.14,
  limitDash: '6 4',
  forecastDash: '4 4',
  forecastSafe: '#8b5cf6',
  forecastRisk: '#f97316',
} as const

const FORECAST_MINUTES = 15

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
        humidity: null,
        fanPowerFault: 0,
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
    // From when the forecast was made, not from the last bucket's start —
    // with 15-minute buckets those can be most of a bucket apart.
    const predTs = new Date(series.prediction.predictedAt).getTime() + FORECAST_MINUTES * 60_000
    // Always true while the server keeps a forecast (15 min TTL); guards
    // against clock skew drawing the line backwards.
    if (lastValidIdx !== -1 && predTs > out[out.length - 1].ts) {
      const lastPoint = out[lastValidIdx]
      // Anchor forecast at last known measured reading so dashed line starts smoothly
      lastPoint.forecast = lastPoint.avg

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
        humidity: null,
        fanPowerFault: 0,
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
          <span>Dự báo AI (+{FORECAST_MINUTES} phút)</span>
        </div>
        <p className="font-medium tabular-nums text-muted-foreground">
          Cho lúc {dayjs(p.ts).format('DD/MM HH:mm')} · dự báo lúc{' '}
          {dayjs(meta.predictedAt).format('HH:mm')}
        </p>
        <p className="mt-1 text-base font-bold tabular-nums">
          Dự báo: <span className="text-purple-600 dark:text-purple-400">{formatTemp(p.forecast)}</span>
        </p>
        {meta.willExceedThreshold ? (
          <p className="mt-1 text-xs font-semibold text-destructive">
            ⚠️ {AI_VIOLATION_LABEL[meta.violationType]} (Mức rủi ro: {AI_RISK_LEVEL_LABEL[meta.riskLevel]})
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
      {p.humidity != null && (
        <p className="tabular-nums">
          Độ ẩm <span className="font-semibold">{formatHumidity(p.humidity)}</span>
        </p>
      )}
      {p.outOfRange > 0 && (
        <p className="text-destructive">{formatNumber(p.outOfRange)} mẫu vượt ngưỡng</p>
      )}
      {p.doorOpen > 0 && <p className="text-warning">Cửa mở trong {formatNumber(p.doorOpen)} mẫu</p>}
      {p.sensorFault > 0 && (
        <p className="text-destructive">{formatNumber(p.sensorFault)} mẫu lỗi cảm biến</p>
      )}
      {(p.fanPowerFault ?? 0) > 0 && (
        <p className="text-destructive">{formatNumber(p.fanPowerFault)} mẫu mất nguồn quạt</p>
      )}
    </div>
  )
}

function OutOfRangeDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload || !isOutOfRangeDot(payload)) return null
  return (
    <circle cx={cx} cy={cy} r={4.5} fill={STYLE.limit} stroke="var(--card)" strokeWidth={2} />
  )
}

function PredictionDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload?.isPredictionPoint) return null
  const color = forecastColor(payload.predictionMeta)
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={color} fillOpacity={0.3} />
      <circle
        cx={cx}
        cy={cy}
        r={4.5}
        fill={color}
        stroke="var(--card)"
        strokeWidth={2}
      />
    </g>
  )
}

function forecastColor(prediction: ColdRoomSeries['prediction'] | undefined) {
  return prediction?.willExceedThreshold ? STYLE.forecastRisk : STYLE.forecastSafe
}

function isOutOfRangeDot(p: Point) {
  return p.outOfRange > 0 && !p.isPredictionPoint && p.avg !== null
}

function LineSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="22" height="10" aria-hidden className="shrink-0">
      <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth={2} strokeDasharray={dash} />
    </svg>
  )
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      <span>{children}</span>
    </li>
  )
}

// Lists exactly the marks the chart below draws, in the same colors and
// dash patterns (STYLE). Items for marks that aren't on screen are left out.
function ChartLegend({
  prediction,
  hasOutOfRange,
}: {
  prediction: ColdRoomSeries['prediction'] | undefined
  hasOutOfRange: boolean
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <LegendItem swatch={<LineSwatch color={STYLE.temp} />}>Nhiệt độ trung bình</LegendItem>
      <LegendItem
        swatch={
          <svg width="22" height="10" aria-hidden className="shrink-0">
            <rect x="1" y="1" width="20" height="8" rx="1.5" fill={STYLE.temp} fillOpacity={STYLE.bandOpacity * 2} />
          </svg>
        }
      >
        Dải thấp nhất – cao nhất
      </LegendItem>
      <LegendItem swatch={<LineSwatch color={STYLE.limit} dash={STYLE.limitDash} />}>
        Ngưỡng cho phép (sàn / trần)
      </LegendItem>
      {hasOutOfRange && (
        <LegendItem
          swatch={
            <svg width="22" height="10" aria-hidden className="shrink-0">
              <circle cx="11" cy="5" r="4" fill={STYLE.limit} />
            </svg>
          }
        >
          Có mẫu vượt ngưỡng
        </LegendItem>
      )}
      {prediction && (
        <LegendItem swatch={<LineSwatch color={forecastColor(prediction)} dash={STYLE.forecastDash} />}>
          <span style={{ color: forecastColor(prediction) }} className="font-medium">
            Dự báo AI +{FORECAST_MINUTES} phút
            {prediction.willExceedThreshold ? ' (nguy cơ vượt ngưỡng)' : ' (trong ngưỡng)'}
          </span>
        </LegendItem>
      )}
    </ul>
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
        <figcaption className="text-sm text-muted-foreground">
          Nhiệt độ theo thời gian, gộp mỗi {series.bucketMinutes} phút
        </figcaption>
        <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Xem biểu đồ' : 'Xem dạng bảng'}
        </Button>
      </div>

      {points.length > 0 && !asTable && (
        <ChartLegend
          // Only when the forecast point was actually placed (toPoints skips it
          // without a usable predictedAt).
          prediction={points.some((p) => p.isPredictionPoint) ? series.prediction : null}
          hasOutOfRange={points.some(isOutOfRangeDot)}
        />
      )}

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
                        (p.fanPowerFault ?? 0) > 0 && 'mất nguồn quạt',
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
            {/* Right margin fits the threshold labels, e.g. "Trần -18 °C". */}
            <ComposedChart data={points} margin={{ top: 16, right: 76, bottom: 0, left: 0 }}>
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
                stroke={STYLE.limit}
                strokeDasharray={STYLE.limitDash}
                strokeWidth={1.5}
                label={{ value: `Trần ${formatTemp(tempMax)}`, position: 'right', fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <ReferenceLine
                y={tempMin}
                stroke={STYLE.limit}
                strokeDasharray={STYLE.limitDash}
                strokeWidth={1.5}
                label={{ value: `Sàn ${formatTemp(tempMin)}`, position: 'right', fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <Area
                dataKey="band"
                stroke="none"
                fill={STYLE.temp}
                fillOpacity={STYLE.bandOpacity}
                isAnimationActive={false}
                connectNulls={false}
                activeDot={false}
              />
              <Line
                dataKey="avg"
                stroke={STYLE.temp}
                strokeWidth={2}
                dot={OutOfRangeDot}
                activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2, fill: STYLE.temp }}
                isAnimationActive={false}
                connectNulls={false}
              />
              {series.prediction && (
                <Line
                  dataKey="forecast"
                  stroke={forecastColor(series.prediction)}
                  strokeWidth={2}
                  strokeDasharray={STYLE.forecastDash}
                  dot={PredictionDot}
                  activeDot={{
                    r: 6,
                    fill: forecastColor(series.prediction),
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
