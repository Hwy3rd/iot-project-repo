import type { UserRole } from '@/api/types'

/**
 * Client-side gating is only for hiding UI — the backend enforces every rule
 * (docs/RBAC.md). A user has one role everywhere; which warehouses they see
 * is decided server-side by their warehouse assignments.
 */
export function hasRole(role: UserRole | undefined, allowed: readonly UserRole[] | undefined) {
  if (!allowed) return true
  return !!role && allowed.includes(role)
}
