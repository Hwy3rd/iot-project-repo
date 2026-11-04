import type { ColdRoomForecast, ColdRoomSeries } from '@/api/types'

export type ForecastChartPoint = ColdRoomSeries['points'][number] & {
  ts: number
  band: [number, number] | null
  forecast?: number | null
  isPredictionPoint?: boolean
  predictionMeta?: ColdRoomSeries['prediction']
  forecastPoint?: ColdRoomForecast
}

export function toForecastPoints(series: ColdRoomSeries): ForecastChartPoint[] {
  const bucketMs = series.bucketMinutes * 60_000
  const out: ForecastChartPoint[] = []
  for (const point of series.points) {
    const ts = new Date(point.t).getTime()
    const previous = out.at(-1)
    if (previous && ts - previous.ts > bucketMs * 1.5) {
      out.push({
        t: new Date(previous.ts + bucketMs).toISOString(),
        ts: previous.ts + bucketMs,
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
      ...point,
      ts,
      band:
        point.min !== null && point.max !== null
          ? [point.min, point.max]
          : null,
      forecast: null,
    })
  }
  const prediction = series.prediction
  if (!prediction || !Array.isArray(prediction.forecasts) || out.length === 0)
    return out
  const asOf = Date.parse(prediction.predictedAt)
  if (!Number.isFinite(asOf)) return out
  const lastValid = out.findLast((point) => point.avg !== null)
  if (!lastValid) return out
  const end = out[out.length - 1].ts
  const forecasts = [...prediction.forecasts].sort(
    (a, b) => a.horizonMinutes - b.horizonMinutes,
  )
  for (const point of forecasts) {
    const ts = asOf + point.horizonMinutes * 60_000
    if (!Number.isFinite(point.predictedTemp) || ts <= end) continue
    lastValid.forecast = lastValid.avg
    out.push({
      t: new Date(ts).toISOString(),
      ts,
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
      forecast: point.predictedTemp,
      isPredictionPoint: true,
      predictionMeta: prediction,
      forecastPoint: point,
    })
  }
  return out
}
