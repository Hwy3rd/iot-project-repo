import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { ApiError } from './api/client'
import { AuthProvider } from './auth/AuthProvider'
import { ThemeColorSync } from './components/common/ThemeColorSync'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import './index.css'
import './lib/format' // registers the dayjs "vi" locale + plugins
import { registerServiceWorker } from './lib/push'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Client errors (401/403/404…) won't succeed on retry.
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" storageKey="theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ThemeColorSync />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
      {/* Below the sticky app header (h-14 + iOS safe area), not over the bell and account menu. */}
      <Toaster
        position="top-right"
        offset={{ top: 'calc(3.5rem + env(safe-area-inset-top) + 0.75rem)', right: '1rem' }}
        mobileOffset={{ top: 'calc(3.5rem + env(safe-area-inset-top) + 0.5rem)' }}
        richColors
        closeButton
      />
    </ThemeProvider>
  </StrictMode>,
)
