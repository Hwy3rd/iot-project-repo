import { ApiError, onSessionExpired } from '@/api/client'
import { disconnectSocket } from '@/lib/socket'
import { authApi } from '@/api/endpoints'
import type { User } from '@/api/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AuthContext, type AuthContextValue } from './auth-context'

const ME_KEY = ['auth', 'me'] as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await authApi.me()
      } catch (err) {
        // Not logged in is a normal state, not an error.
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: Infinity,
    retry: false,
  })

  // Refresh failed somewhere (expired, or logged in elsewhere — one session per user).
  useEffect(
    () =>
      onSessionExpired(() => {
        // Only announce it if someone was actually logged in.
        if (qc.getQueryData(ME_KEY)) {
          toast.warning('Phiên đăng nhập đã hết hạn', {
            description: 'Đăng nhập lại để tiếp tục. Tài khoản có thể vừa đăng nhập ở nơi khác.',
          })
        }
        disconnectSocket()
        qc.setQueryData(ME_KEY, null)
      }),
    [qc],
  )

  // Drop every cached query from the previous session except `me` itself —
  // qc.clear() would also detach the observer below from the me query.
  // The realtime socket was authenticated as the previous user too.
  const resetCache = useCallback(() => {
    disconnectSocket()
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
  }, [qc])

  const login = useCallback(
    async (username: string, password: string) => {
      const user = await authApi.login({ username, password })
      resetCache()
      qc.setQueryData<User | null>(ME_KEY, user)
      return user
    },
    [qc, resetCache],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      resetCache()
      qc.setQueryData(ME_KEY, null)
    }
  }, [qc, resetCache])

  const value = useMemo<AuthContextValue>(
    () => ({ user: me.data ?? null, isLoading: me.isPending, login, logout }),
    [me.data, me.isPending, login, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
