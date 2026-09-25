import type { UserRole } from '@/api/types'

/**
 * Client-side gating is only for hiding UI — the backend enforces every rule
 * (docs/RBAC.md). Note it uses the user's *global* role: a user can hold a
 * different role inside a specific warehouse, and warehouse-scoped lists are
 * filtered server-side by that per-warehouse role.
 */
export function hasRole(role: UserRole | undefined, allowed: readonly UserRole[] | undefined) {
  if (!allowed) return true
  return !!role && allowed.includes(role)
}
