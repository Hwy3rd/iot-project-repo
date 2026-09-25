import type { UserRole } from '@/api/types'
import { FullPageSpinner } from '@/components/common/States'
import { ForbiddenPage } from '@/pages/StatusPages'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './auth-context'
import { hasRole } from './permissions'

/** Layout route: renders children only when logged in, else → /login?next=… */
export function RequireAuth() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <FullPageSpinner />
  if (!user) {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

/** Layout route: children only for the listed global roles; keeps the URL on 403. */
export function RequireRole({ roles }: { roles: readonly UserRole[] }) {
  const { user } = useAuth()
  if (!hasRole(user?.role, roles)) return <ForbiddenPage />
  return <Outlet />
}
