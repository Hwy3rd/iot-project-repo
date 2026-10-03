# Frontend — ColdChain

React 19 + Vite + TypeScript, Tailwind CSS v4 + shadcn/ui (radix, preset nova), TanStack Query, React Router, axios, react-hook-form, dayjs, sonner, next-themes.

## Chạy dev

```bash
cp .env.example .env   # tuỳ chọn
pnpm install
pnpm dev               # http://localhost:5173, backend ở http://localhost:3000
```

Dev server proxy `/api/*` → backend (bỏ tiền tố `/api`) và `/socket.io` → backend, nên cookie auth là same-origin. Backend giới hạn `refresh_token` ở path `/auth`, nên proxy viết lại path cookie thành `/api/auth`.

Production: đặt `VITE_API_URL` trỏ tới origin của API (và thêm origin frontend vào `CORS_ORIGINS` của backend).

## Cấu trúc

```
src/
  api/          client.ts (axios: bóc envelope, ApiError, interceptor tự refresh khi 401), types.ts, endpoints.ts
  auth/         AuthProvider, useAuth, guards (RequireAuth / RequireRole), permissions
  components/
    ui/         component shadcn — thêm bằng `pnpm dlx shadcn@latest add <tên>`
    common/     component dùng chung của app: PageHeader, StatusBadge, States, Pagination, ThemeColorSync
    layout/     AppShell, AppSidebar (shadcn Sidebar), UserMenu, NotificationBell, nav.ts (menu + role)
    monitoring/ màn Giám sát trực tiếp: RoomTile (lưới phòng), RoomSwitcher (thanh chuyển phòng), RoomFocus
                (chi tiết 1 phòng ngay trên trang), TemperatureChart, AlertStream
    commands/   DeviceControls (nút Bật/Tắt nhanh, dùng ở Giám sát và Thiết bị), CreateCommandDialog
    devices/    DeviceDetailPanels (tab Kênh: giá trị gần nhất từng kênh, thêm kênh mặc định)
  hooks/        use-mobile
  lib/          format (dayjs locale vi), labels (enum → tiếng Việt), utils (cn), env, errors, usePageParam,
                usePreference (lựa chọn UI lưu localStorage), useWarehouseLive (socket),
                channel-readings (kênh khai báo → chỉ số hiển thị / thiếu dữ liệu),
                device-commands (lệnh gần nhất mỗi kênh, trạng thái suy ra từ lệnh đã ack)
  pages/        Dashboard, Warehouses (trang danh sách mẫu), Login (react-hook-form), Placeholder, StatusPages
  router.tsx
```

## Quy ước

- Màu dùng token của shadcn (`bg-card`, `text-muted-foreground`, `border`, `bg-primary`, `text-destructive`…) cộng thêm `success`/`warning`/`info`, định nghĩa ở `src/index.css`; không dùng mã màu trực tiếp. Dark mode là class `.dark` trên `<html>` (next-themes).
- Form dùng react-hook-form + component `Field` của shadcn, lỗi hiển thị ngay dưới field; thông báo sau thao tác dùng `toast` của sonner.
- Ngày giờ format qua `src/lib/format.ts` (dayjs), không gọi `dayjs().format()` rải rác trong component.
- Trạng thái danh sách (trang, bộ lọc) đặt trên URL query — xem `WarehousesPage` + `usePageParam`.
- Lựa chọn hiển thị cần giữ qua reload (khoảng biểu đồ, phần đang thu gọn...) lưu bằng `usePreference`, key theo đối tượng (vd `monitoring:room:<id>:range`, `monitoring:room:<id>:controls:<deviceId>`). Chỉ lưu trên trình duyệt đang dùng.
- Trạng thái quạt/còi lấy từ telemetry, nhưng lệnh thiết bị đã ack sau mẫu telemetry thì thắng (`withCommandedState`): firmware đổi relay trước khi ack, nên UI không phải chờ mẫu kế tiếp hay socket. Số liệu của phòng mất tín hiệu (> 10 phút) hiển thị mờ, không áp trạng thái này.
- Ẩn/hiện UI theo role chỉ để tiện dùng; quyền thực sự do backend kiểm tra (`docs/RBAC.md`). Mỗi tài khoản chỉ có một role, dùng ở mọi kho; danh sách gắn kho đã được backend lọc theo các kho user được phân công. Admin phân công người vào kho trong dialog chi tiết kho (`WarehouseStaffSection`).
- Review UI theo skill `web-design-guidelines` (`.agents/skills/`).
