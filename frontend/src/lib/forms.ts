import { ApiError } from '@/api/client'

// Helpers for the create/edit dialogs. Form values stay strings (what inputs
// hold); they are validated as strings and converted when building the body.

/** Blank → undefined, so optional fields are left out of the request body. */
export const optionalText = (value: string) => value.trim() || undefined

/** Blank → undefined, else the number (call only after numberRule passed). */
export const optionalNumber = (value: string) => (value.trim() ? Number(value) : undefined)

/** Edit forms: blank → null, so PATCH clears the field instead of leaving it as is. */
export const nullableText = (value: string) => value.trim() || null

/** Edit forms: blank → null (call only after numberRule passed). */
export const nullableNumber = (value: string) => (value.trim() ? Number(value) : null)

/** Form value for an optional field loaded from the API. */
export const toInput = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value)

/** react-hook-form `validate` for a numeric text input. */
export function numberRule({
  required,
  integer,
  min,
  label,
}: {
  required?: boolean
  integer?: boolean
  min?: number
  /** Lower-case noun phrase, e.g. "nhiệt độ tối đa". */
  label: string
}) {
  const subject = label.charAt(0).toUpperCase() + label.slice(1)
  return (value: string) => {
    const text = value.trim()
    if (!text) return required ? `Nhập ${label}.` : true
    const n = Number(text)
    if (!Number.isFinite(n)) return `${subject} phải là số.`
    if (integer && !Number.isInteger(n)) return `${subject} phải là số nguyên.`
    if (min !== undefined && n < min) return `${subject} không được nhỏ hơn ${min}.`
    return true
  }
}

export const requiredText = (message: string) => (value: string) => !!value.trim() || message

/**
 * Message for a failed create or update. `byStatus` overrides per HTTP status (e.g. 409
 * for a duplicate); 400 falls back to the validator's messages.
 */
export function mutationErrorText(
  err: unknown,
  byStatus: Partial<Record<number, string>> = {},
  fallback = 'Không lưu được. Thử lại sau ít phút.',
) {
  if (err instanceof ApiError) {
    const override = byStatus[err.status]
    if (override) return override
    if (err.status === 400 && err.errors.length) return err.errors.join(' ')
    if (err.status === 403) return 'Bạn không có quyền thực hiện thao tác này.'
    return err.message
  }
  return fallback
}
