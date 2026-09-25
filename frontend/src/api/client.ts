import { env } from '@/lib/env'
import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import type { ApiEnvelope, ApiErrorBody } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly errors: string[]

  constructor(status: number, message: string, errors: string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }
}

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Skip the refresh-and-retry on 401 (auth calls themselves, and the retried request). */
    skipRefresh?: boolean
  }
}

// Auth rides on httpOnly cookies, never an Authorization header.
export const http = axios.create({ baseURL: env.apiUrl, withCredentials: true })

// Listeners told when the session is gone for good (refresh failed).
const sessionExpiredListeners = new Set<() => void>()
export function onSessionExpired(fn: () => void) {
  sessionExpiredListeners.add(fn)
  return () => {
    sessionExpiredListeners.delete(fn)
  }
}

/**
 * - `refreshed`: new cookies are set, retry what failed.
 * - `expired`: the server rejected the refresh token (4xx: missing, expired,
 *   rotated away by a login elsewhere) — the session is really over.
 * - `unavailable`: no verdict (offline, timeout, 5xx) — the session may
 *   well still be valid, so nobody gets logged out over a network blip.
 */
export type RefreshOutcome = 'refreshed' | 'expired' | 'unavailable'

// Single-flight: concurrent 401s share one POST /auth/refresh, because the
// backend rotates the refresh token and a second refresh would be rejected.
let refreshing: Promise<RefreshOutcome> | null = null
export function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= http
    .post('/auth/refresh', undefined, { skipRefresh: true })
    .then((): RefreshOutcome => 'refreshed')
    .catch((err: unknown): RefreshOutcome =>
      // The call went through the interceptor below, so errors are ApiErrors
      // (status 0 = no response).
      err instanceof ApiError && err.status >= 400 && err.status < 500 ? 'expired' : 'unavailable',
    )
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

function toApiError(err: AxiosError<Partial<ApiErrorBody>>): ApiError {
  if (!err.response) {
    return new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.')
  }
  const { status, data, statusText } = err.response
  return new ApiError(status, data?.message ?? (statusText || 'Lỗi không xác định'), data?.errors ?? [])
}

http.interceptors.response.use(
  // Unwrap the { success, statusCode, message, data } envelope.
  (res) => {
    res.data = (res.data as ApiEnvelope<unknown>)?.data
    return res
  },
  async (err: AxiosError<Partial<ApiErrorBody>>) => {
    if (axios.isCancel(err)) throw err
    const config = err.config as InternalAxiosRequestConfig | undefined

    if (err.response?.status === 401 && config && !config.skipRefresh) {
      const outcome = await refreshSession()
      if (outcome === 'refreshed') {
        return http.request({ ...config, skipRefresh: true })
      }
      if (outcome === 'expired') {
        sessionExpiredListeners.forEach((fn) => fn())
      } else {
        // Report the connection problem, not the 401: a 401 would read as
        // "logged out" (e.g. to the /auth/me query) while the session may
        // be fine once the network is back.
        throw new ApiError(0, 'Không làm mới được phiên đăng nhập do lỗi kết nối. Kiểm tra mạng rồi thử lại.')
      }
    }
    throw toApiError(err)
  },
)

type Query = Record<string, string | number | boolean | null | undefined>

// Thin typed helpers — callers get `data` directly (envelope already unwrapped).
export const api = {
  get: <T>(url: string, params?: Query, config?: AxiosRequestConfig) =>
    http.get<T>(url, { ...config, params }).then((r) => r.data),
  post: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    http.post<T>(url, body, config).then((r) => r.data),
  patch: <T>(url: string, body?: unknown) => http.patch<T>(url, body).then((r) => r.data),
  put: <T>(url: string, body?: unknown) => http.put<T>(url, body).then((r) => r.data),
  delete: <T>(url: string, body?: unknown) => http.delete<T>(url, { data: body }).then((r) => r.data),
}
