import { QuickChat } from '@/components/chatbot/QuickChat'
import { AttendanceGate } from '@/components/work-shifts/AttendanceGate'
import { WorkShiftNotifier } from '@/components/work-shifts/WorkShiftNotifier'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { usePushBridge } from '@/lib/usePushNotifications'
import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import { AppSidebar } from './AppSidebar'
import { HeaderClock } from './HeaderClock'
import { NotificationBell } from './NotificationBell'
import { UserMenu } from './UserMenu'
import { WarehouseSwitcher } from './WarehouseSwitcher'

export function AppShell() {
  const { pathname } = useLocation()
  const contentRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const shellRef = useRef<HTMLElement>(null)
  usePushBridge()

  // The header can wrap, or grow with safe-area insets and larger text.
  // Viewport-sized pages must use its actual height instead of a fixed guess.
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const measure = () => shellRef.current?.style.setProperty('--app-header-height', `${header.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

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
      <SidebarInset ref={shellRef} className="min-w-0">
        <header ref={headerRef} className="sticky top-0 z-10 flex min-h-14 shrink-0 flex-wrap items-center gap-1 border-b bg-background/90 px-3 pt-[env(safe-area-inset-top)] pb-2 backdrop-blur sm:flex-nowrap sm:gap-2 sm:px-4 sm:pb-0">
          <SidebarTrigger className="-ml-1" aria-label="Bật/tắt thanh điều hướng" />
          <Separator orientation="vertical" className="hidden data-[orientation=vertical]:h-4 sm:block" />
          <WarehouseSwitcher />
          <div className="min-w-0 flex-1" />
          <HeaderClock />
          <NotificationBell />
          <UserMenu />
        </header>
        <div
          id="main"
          ref={contentRef}
          tabIndex={-1}
          className="mx-auto min-w-0 w-full max-w-7xl px-3 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none sm:px-6 sm:pt-6 [scroll-margin-top:var(--app-header-height,3.5rem)]"
        >
          {/* Staff must be on an approved shift to use anything. */}
          <AttendanceGate>
            <Outlet />
            <QuickChat />
          </AttendanceGate>
        </div>
        <WorkShiftNotifier />
      </SidebarInset>
    </SidebarProvider>
  )
}
