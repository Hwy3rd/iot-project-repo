import { createBrowserRouter } from 'react-router'
import { RequireAuth, RequireRole } from './auth/guards'
import { AppShell } from './components/layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { NotFoundPage, RouteErrorPage } from './pages/StatusPages'
import { WarehousesPage } from './pages/WarehousesPage'

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
          { path: 'alerts', ...placeholder('Cảnh báo', 'Theo dõi, tiếp nhận và xử lý cảnh báo.') },
          { path: 'devices', ...placeholder('Thiết bị', 'Thiết bị IoT và vòng đời kỹ thuật.') },
          { path: 'commands', ...placeholder('Lệnh điều khiển', 'Lịch sử và gửi lệnh bật/tắt kênh thiết bị.') },
          { path: 'warehouses', element: <WarehousesPage /> },
          { path: 'cold-rooms', ...placeholder('Phòng lạnh', 'Phòng lạnh và cấu hình ngưỡng nhiệt độ.') },
          { path: 'product-types', ...placeholder('Loại sản phẩm', 'Danh mục loại sản phẩm dùng chung.') },
          { path: 'shifts', ...placeholder('Mẫu ca', 'Mẫu ca sáng/chiều/tối dùng chung.') },
          { path: 'notifications', ...placeholder('Thông báo', 'Thông báo của bạn.') },
          { path: 'chatbot', ...placeholder('Trợ lý AI', 'Hỏi đáp về dữ liệu kho trong phạm vi của bạn.') },
          {
            element: <RequireRole roles={['admin', 'manager', 'staff']} />,
            children: [
              { path: 'batches', ...placeholder('Lô hàng', 'Nhập/xuất và theo dõi hạn sử dụng lô hàng.') },
              { path: 'work-shifts', ...placeholder('Ca trực', 'Lịch ca trực và check-in/check-out.') },
            ],
          },
          {
            element: <RequireRole roles={['admin', 'manager']} />,
            children: [
              { path: 'audit-logs', ...placeholder('Nhật ký hệ thống', 'Nhật ký thao tác (chỉ xem).') },
            ],
          },
          {
            element: <RequireRole roles={['admin']} />,
            children: [
              { path: 'users', ...placeholder('Người dùng', 'Tài khoản, vai trò và khoá/mở khoá.') },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
