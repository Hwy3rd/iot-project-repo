import { api } from './client'
import type {
  Alert,
  AlertStatus,
  AlertType,
  AppNotification,
  ColdRoom,
  Device,
  PageQuery,
  Paginated,
  User,
  Warehouse,
} from './types'

export const authApi = {
  login: (body: { username: string; password: string }) =>
    api.post<User>('/auth/login', body, { skipRefresh: true }),
  logout: () => api.post<null>('/auth/logout', undefined, { skipRefresh: true }),
  me: () => api.get<User>('/auth/me'),
}

/**
 * `search` and the filters are sent ahead of backend support: the API's
 * ValidationPipe (whitelist, no forbidNonWhitelisted) drops unknown params,
 * so until it implements them the list simply comes back unfiltered.
 */
export interface WarehouseQuery extends PageQuery {
  search?: string
  /** YYYY-MM-DD, inclusive. */
  createdFrom?: string
  createdTo?: string
  hasAddress?: boolean
}

export interface CreateWarehouseBody {
  name: string
  code: string
  address?: string
}

export const warehousesApi = {
  list: (q: WarehouseQuery = {}) =>
    api.get<Paginated<Warehouse>>('/warehouses', {
      ...q,
      hasAddress: q.hasAddress === undefined ? undefined : String(q.hasAddress),
    }),
  get: (id: string) => api.get<Warehouse>(`/warehouses/${id}`),
  create: (body: CreateWarehouseBody) => api.post<Warehouse>('/warehouses', body),
}

export const coldRoomsApi = {
  list: (q: PageQuery = {}) => api.get<Paginated<ColdRoom>>('/cold-rooms', { ...q }),
}

export const devicesApi = {
  list: (q: PageQuery = {}) => api.get<Paginated<Device>>('/devices', { ...q }),
}

export interface AlertQuery extends PageQuery {
  status?: AlertStatus
  type?: AlertType
  coldRoomId?: string
  deviceId?: string
  batchId?: string
}

export const alertsApi = {
  list: (q: AlertQuery = {}) => api.get<Paginated<Alert>>('/alerts', { ...q }),
  acknowledge: (id: string) => api.post<Alert>(`/alerts/${id}/acknowledge`),
  resolve: (id: string) => api.post<Alert>(`/alerts/${id}/resolve`),
}

export const notificationsApi = {
  list: (q: PageQuery & { unreadOnly?: boolean } = {}) =>
    api.get<Paginated<AppNotification>>('/notifications', {
      ...q,
      // Backend expects the literal strings "true"/"false".
      unreadOnly: q.unreadOnly === undefined ? undefined : String(q.unreadOnly),
    }),
  markRead: (id: string) => api.post<AppNotification>(`/notifications/${id}/read`),
}
