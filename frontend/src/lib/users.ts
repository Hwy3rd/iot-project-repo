import type { User } from '@/api/types'

/** The newest uploaded image is the avatar (replacing one uploads, then drops the old). */
export const avatarUrl = (user: Pick<User, 'imageUrls'>) => user.imageUrls?.at(-1) ?? null

export const displayName = (user: Pick<User, 'username' | 'fullName'>) => user.fullName || user.username
