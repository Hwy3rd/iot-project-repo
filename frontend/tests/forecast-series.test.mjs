import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toForecastPoints } from '../src/lib/forecast-series.ts'

const asOf = '2026-11-01T10:00:00.000Z'
function series() {
  return {
    coldRoomId: 'room1',
    from: '2026-11-01T09:00:00Z',
    to: asOf,
    bucketMinutes: 1,
    tempMin: 0,
    tempMax: 4,
    points: [
      {
        t: asOf,
        avg: 3,
        min: 3,
        max: 3,
        samples: 1,
        outOfRange: 0,
        doorOpen: 0,
        sensorFault: 0,
        humidity: null,
        fanPowerFault: 0,
      },
    ],
    prediction: {
      predictedAt: asOf,
      firstViolationMinutes: 5,
      willExceedThreshold: true,
      violationType: 'OVERHEAT',
      riskLevel: 'WARNING',
      recommendation: 'Check door',
      forecasts: [
        {
          horizonMinutes: 5,
          predictedTemp: 5,
          willExceedThreshold: true,
          violationType: 'OVERHEAT',
        },
        {
          horizonMinutes: 10,
          predictedTemp: 3,
          willExceedThreshold: false,
          violationType: 'NONE',
        },
      ],
    },
  }
}

test('plots +5 and +10 at their own timestamps and preserves a transient breach', () => {
  const points = toForecastPoints(series())
  const future = points.filter((point) => point.isPredictionPoint)
  assert.deepEqual(
    future.map((point) => [point.t, point.forecast]),
    [
      ['2026-11-01T10:05:00.000Z', 5],
      ['2026-11-01T10:10:00.000Z', 3],
    ],
  )
  assert.equal(future[0].forecastPoint.willExceedThreshold, true)
  assert.equal(future[1].forecastPoint.willExceedThreshold, false)
  assert.ok(future.every((point) => point.samples === 0 && point.avg === null))
})

test('anchors to a measured reading without mutating the API response', () => {
  const input = series()
  const before = structuredClone(input)
  assert.equal(toForecastPoints(input)[0].forecast, 3)
  assert.deepEqual(input, before)
})

test('forecast time follows the input timestamp, independently of bucket boundaries', () => {
  const input = series()
  input.bucketMinutes = 15
  input.points[0].t = '2026-11-01T09:45:00.000Z'
  assert.equal(
    toForecastPoints(input).filter((point) => point.isPredictionPoint)[0].ts,
    Date.parse(asOf) + 5 * 60_000,
  )
})

test('does not draw targets before already measured points', () => {
  const input = series()
  input.points[0].t = '2026-11-01T10:06:00.000Z'
  assert.deepEqual(
    toForecastPoints(input)
      .filter((point) => point.isPredictionPoint)
      .map((point) => point.forecastPoint.horizonMinutes),
    [10],
  )
})

test('ignores a legacy forecast and invalid timestamps without crashing', () => {
  const input = series()
  input.prediction = { predictedAt: asOf, predictedTemp15m: 4 }
  assert.equal(toForecastPoints(input).length, 1)
  input.prediction = series().prediction
  input.prediction.predictedAt = 'bad'
  assert.equal(toForecastPoints(input).length, 1)
})

test('keeps missing measured buckets as gaps and skips empty/fault-only history', () => {
  const input = series()
  input.points.unshift({ ...input.points[0], t: '2026-11-01T09:55:00Z' })
  assert.equal(toForecastPoints(input)[1].avg, null)
  input.points = []
  assert.deepEqual(toForecastPoints(input), [])
  input.points = [{ ...series().points[0], avg: null, min: null, max: null }]
  assert.equal(
    toForecastPoints(input).filter((point) => point.isPredictionPoint).length,
    0,
  )
})
