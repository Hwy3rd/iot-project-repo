import { Button } from '@/components/ui/button'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

function StatusLayout({ code, title, body }: { code: string; title: string; body: string }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <p className="text-4xl font-semibold text-muted-foreground tabular-nums">{code}</p>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-pretty text-muted-foreground">{body}</p>
        <Button asChild size="lg" className="mt-3">
          <Link to="/">Về trang tổng quan</Link>
        </Button>
      </div>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <StatusLayout
      code="404"
      title="Không tìm thấy trang"
      body="Đường dẫn không tồn tại hoặc đã bị thay đổi. Kiểm tra lại địa chỉ."
    />
  )
}

export function ForbiddenPage() {
  return (
    <StatusLayout
      code="403"
      title="Bạn không có quyền truy cập"
      body="Vai trò hiện tại không được phép mở trang này. Liên hệ quản trị viên nếu bạn cần quyền."
    />
  )
}

export function RouteErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <h1 className="text-xl font-semibold">Đã xảy ra lỗi</h1>
        <p className="text-pretty text-muted-foreground">
          Trang gặp lỗi ngoài dự kiến. Tải lại trang; nếu vẫn lỗi, báo cho quản trị viên.
        </p>
        <Button onClick={() => window.location.reload()}>Tải lại trang</Button>
      </div>
    </div>
  )
}
