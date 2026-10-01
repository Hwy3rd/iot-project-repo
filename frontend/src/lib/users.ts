import type { User } from '@/api/types'

/** Username/password length bounds the server enforces (libs/constants/auth.constant.ts). */
export const USERNAME_MAX_LENGTH = 50
export const PASSWORD_MIN_LENGTH = 6
export const PASSWORD_MAX_LENGTH = 64

export const PASSWORD_LENGTH_HINT = `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} ký tự.`

/** react-hook-form rules for any field that sets a new password. */
export const newPasswordRules = {
  required: 'Nhập mật khẩu mới.',
  minLength: { value: PASSWORD_MIN_LENGTH, message: `Mật khẩu tối thiểu ${PASSWORD_MIN_LENGTH} ký tự.` },
  maxLength: { value: PASSWORD_MAX_LENGTH, message: `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.` },
}

/** The newest uploaded image is the avatar (replacing one uploads, then drops the old). */
export const avatarUrl = (user: Pick<User, 'imageUrls'>) => user.imageUrls?.at(-1) ?? null

/** The temporary failed-login block's end, if one is still running. */
export function loginBlockedUntil(user: Pick<User, 'loginBlockedUntil'>) {
  const until = user.loginBlockedUntil
  return until && new Date(until).getTime() > Date.now() ? until : null
}

export const displayName = (user: Pick<User, 'username' | 'fullName'>) => user.fullName || user.username
