import { QuickChat } from '@/components/chatbot/QuickChat'
import { AttendanceGate } from '@/components/work-shifts/AttendanceGate'
import { WorkShiftNotifier } from '@/components/work-shifts/WorkShiftNotifier'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useLiveSync } from '@/lib/useLiveSync'
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
  usePushBridge()
  // Readings and alert changes update every page as they happen.
  useLiveSync(true)

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
          <WarehouseSwitcher />
          <div className="flex-1" />
          <HeaderClock />
          <NotificationBell />
          <UserMenu />
        </header>
        <div
          id="main"
          ref={contentRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl px-4 pt-6 pb-24 outline-none sm:px-6 [scroll-margin-top:3.5rem]"
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
