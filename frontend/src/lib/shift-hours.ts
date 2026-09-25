import type { Shift } from '@/api/types'

// Mirrors server/src/modules/shifts/shift-hours.ts, so the form can warn
// before saving; the server still decides.

const DAY_MINUTES = 24 * 60

interface Hours {
  startTime: string
  endTime: string
}

/** Minutes since midnight of HH:mm or HH:mm:ss. */
export const minuteOfDay = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** [start, end) minute ranges in one day; an overnight shift splits at midnight. */
export function dayRanges({ startTime, endTime }: Hours): [number, number][] {
  const start = minuteOfDay(startTime)
  const end = minuteOfDay(endTime)
  if (end > start) return [[start, end]]
  return ([
    [start, DAY_MINUTES],
    [0, end],
  ] as [number, number][]).filter(([from, to]) => to > from)
}

/** Touching ends (14:00 / 14:00) don't overlap. */
export const hoursOverlap = (a: Hours, b: Hours) =>
  dayRanges(a).some(([aFrom, aTo]) => dayRanges(b).some(([bFrom, bTo]) => aFrom < bTo && bFrom < aTo))

/** HH:mm:ss → HH:mm */
export const clock = (t: string) => t.slice(0, 5)

export const isOvernight = (s: Hours) => minuteOfDay(s.endTime) <= minuteOfDay(s.startTime)

export const shiftHours = (s: Hours) =>
  `${clock(s.startTime)} – ${clock(s.endTime)}${isOvernight(s) ? ' (hôm sau)' : ''}`

/** e.g. 90 → "1 giờ 30 phút" */
export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} phút`
  return m ? `${h} giờ ${m} phút` : `${h} giờ`
}

export function shiftDuration(s: Hours) {
  const length = minuteOfDay(s.endTime) - minuteOfDay(s.startTime)
  return formatMinutes(length > 0 ? length : length + DAY_MINUTES)
}

/** Minutes of the day covered by no template. */
export function uncoveredMinutes(shifts: Shift[]) {
  const covered = shifts.flatMap(dayRanges).reduce((sum, [from, to]) => sum + to - from, 0)
  return DAY_MINUTES - covered
}
