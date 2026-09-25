import { createBrowserRouter } from 'react-router'
import { RequireAuth, RequireRole } from './auth/guards'
import { AppShell } from './components/layout/AppShell'
import { AlertsPage } from './pages/AlertsPage'
import { AuditLogsPage } from './pages/AuditLogsPage'
import { BatchesPage } from './pages/BatchesPage'
import { ColdRoomsPage } from './pages/ColdRoomsPage'
import { CommandsPage } from './pages/CommandsPage'
import { DashboardPage } from './pages/DashboardPage'
import { DevicesPage } from './pages/DevicesPage'
import { LoginPage } from './pages/LoginPage'
import { MonitoringPage } from './pages/MonitoringPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { ProductTypesPage } from './pages/ProductTypesPage'
import { NotFoundPage, RouteErrorPage } from './pages/StatusPages'
import { UsersPage } from './pages/UsersPage'
import { WarehousesPage } from './pages/WarehousesPage'
import { WorkShiftsPage } from './pages/WorkShiftsPage'

const placeholder = (title: string, description: string) => ({
  element: <PlaceholderPage title={title} description={description} />,
})

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'monitoring', element: <MonitoringPage /> },
          { path: 'alerts', element: <AlertsPage /> },
          { path: 'devices', element: <DevicesPage /> },
          { path: 'commands', element: <CommandsPage /> },
          { path: 'warehouses', element: <WarehousesPage /> },
          { path: 'cold-rooms', element: <ColdRoomsPage /> },
          { path: 'product-types', element: <ProductTypesPage /> },
          { path: 'shifts', ...placeholder('Mẫu ca', 'Mẫu ca sáng/chiều/tối dùng chung.') },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'chatbot', ...placeholder('Trợ lý AI', 'Hỏi đáp về dữ liệu kho trong phạm vi của bạn.') },
          {
            element: <RequireRole roles={['admin', 'manager', 'staff']} />,
            children: [
              { path: 'batches', element: <BatchesPage /> },
              { path: 'work-shifts', element: <WorkShiftsPage /> },
            ],
          },
          {
            element: <RequireRole roles={['admin', 'manager']} />,
            children: [
              { path: 'audit-logs', element: <AuditLogsPage /> },
            ],
          },
          {
            element: <RequireRole roles={['admin']} />,
            children: [
              { path: 'users', element: <UsersPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
