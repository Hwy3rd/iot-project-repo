import type { User } from '@/api/types'
import { createContext, useContext } from 'react'

export interface AuthContextValue {
  user: User | null
  isLoading: boolean
  /** Couldn't tell whether anyone is logged in (network/server error), and no user was known before. */
  error: unknown
  retry: () => void
  login: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
