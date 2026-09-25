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

// Single-flight: concurrent 401s share one POST /auth/refresh, because the
// backend rotates the refresh token and a second refresh would be rejected.
let refreshing: Promise<boolean> | null = null
export function refreshSession(): Promise<boolean> {
  refreshing ??= http
    .post('/auth/refresh', undefined, { skipRefresh: true })
    .then(() => true)
    .catch(() => false)
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
      if (await refreshSession()) {
        return http.request({ ...config, skipRefresh: true })
      }
      sessionExpiredListeners.forEach((fn) => fn())
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
