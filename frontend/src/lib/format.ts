import dayjs from 'dayjs'
import 'dayjs/locale/vi'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
dayjs.locale('vi')

export { dayjs }

const number = new Intl.NumberFormat('vi-VN')

export function formatDateTime(iso: string | null | undefined) {
  return iso ? dayjs(iso).format('DD/MM/YYYY HH:mm') : '—'
}

export function formatDate(iso: string | null | undefined) {
  return iso ? dayjs(iso).format('DD/MM/YYYY') : '—'
}

export function formatRelative(iso: string | null | undefined) {
  return iso ? dayjs(iso).fromNow() : '—'
}

export function formatNumber(n: number | null | undefined) {
  return n === null || n === undefined ? '—' : number.format(n)
}

export function formatTemp(c: number | null | undefined) {
  return c === null || c === undefined ? '—' : `${number.format(c)}\u00a0°C`
}

/** A duration in whole minutes: "12 phút", "1 giờ", "1 giờ 5 phút". */
export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${formatNumber(m)} phút`
  return m === 0 ? `${formatNumber(h)} giờ` : `${formatNumber(h)} giờ ${formatNumber(m)} phút`
}
