import type { UserRole } from '@/api/types'
import { ErrorState, FullPageSpinner } from '@/components/common/States'
import { ForbiddenPage } from '@/pages/StatusPages'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './auth-context'
import { hasRole } from './permissions'

/** Layout route: renders children only when logged in, else → /login?next=… */
export function RequireAuth() {
  const { user, isLoading, error, retry } = useAuth()
  const location = useLocation()

  if (isLoading) return <FullPageSpinner />
  // Unknown ≠ logged out: don't bounce to /login over a network error.
  if (error) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
        <ErrorState error={error} onRetry={retry} />
      </div>
    )
  }
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
