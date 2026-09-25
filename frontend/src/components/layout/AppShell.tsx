import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import { AppSidebar } from './AppSidebar'
import { NotificationBell } from './NotificationBell'
import { UserMenu } from './UserMenu'

export function AppShell() {
  const { pathname } = useLocation()
  const contentRef = useRef<HTMLDivElement>(null)

  // New page: move focus to the content so screen readers announce it and
  // keyboard users don't stay on the old nav link.
  useEffect(() => {
    contentRef.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <SidebarProvider>
      <a
        href="#main"
        className="fixed top-2 left-2 z-50 -translate-y-16 rounded-md bg-primary px-3 py-2 text-primary-foreground focus-visible:translate-y-0"
      >
        Bỏ qua tới nội dung chính
      </a>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label="Bật/tắt thanh điều hướng" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <div className="flex-1" />
          <NotificationBell />
          <UserMenu />
        </header>
        <div
          id="main"
          ref={contentRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6 [scroll-margin-top:3.5rem]"
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
