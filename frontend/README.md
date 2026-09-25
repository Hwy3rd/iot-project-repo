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
  hooks/        use-mobile
  lib/          format (dayjs locale vi), labels (enum → tiếng Việt), utils (cn), env, errors, usePageParam
  pages/        Dashboard, Warehouses (trang danh sách mẫu), Login (react-hook-form), Placeholder, StatusPages
  router.tsx
```

## Quy ước

- Màu dùng token của shadcn (`bg-card`, `text-muted-foreground`, `border`, `bg-primary`, `text-destructive`…) cộng thêm `success`/`warning`/`info`, định nghĩa ở `src/index.css`; không dùng mã màu trực tiếp. Dark mode là class `.dark` trên `<html>` (next-themes).
- Form dùng react-hook-form + component `Field` của shadcn, lỗi hiển thị ngay dưới field; thông báo sau thao tác dùng `toast` của sonner.
- Ngày giờ format qua `src/lib/format.ts` (dayjs), không gọi `dayjs().format()` rải rác trong component.
- Trạng thái danh sách (trang, bộ lọc) đặt trên URL query — xem `WarehousesPage` + `usePageParam`.
- Ẩn/hiện UI theo role chỉ để tiện dùng; quyền thực sự do backend kiểm tra (`docs/RBAC.md`). Menu xét theo role **toàn cục**, trong khi role tại từng kho có thể khác — danh sách gắn kho đã được backend lọc theo role tại kho.
- Review UI theo skill `web-design-guidelines` (`.agents/skills/`).
