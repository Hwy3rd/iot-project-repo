import { useAuth } from '@/auth/auth-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  isPushSupported,
  pushPreferenceKey,
  syncPush,
} from './push'
import { usePreference } from './usePreference'

export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

// Whether this browser currently holds a push subscription.
const SUBSCRIPTION_KEY = ['push-subscription'] as const

/** This device's push notifications for the logged-in user (see lib/push.ts). */
export function usePushNotifications() {
  const { user } = useAuth()
  const [pref, setPref] = usePreference(pushPreferenceKey(user?.id ?? ''), 'off', ['on', 'off'])
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const supported = isPushSupported()
  const { data: subscribed } = useQuery({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: async () => !!(await currentPushSubscription()),
    enabled: supported,
    staleTime: Infinity,
  })
  let state: PushState = 'off'
  if (!supported) state = 'unsupported'
  else if (Notification.permission === 'denied') state = 'denied'
  else if (pref === 'on' && Notification.permission === 'granted' && subscribed) state = 'on'

  const run = async (action: () => Promise<void>, nextPref: 'on' | 'off') => {
    setBusy(true)
    try {
      await action()
      setPref(nextPref)
    } finally {
      setBusy(false)
      await qc.invalidateQueries({ queryKey: SUBSCRIPTION_KEY })
    }
  }

  return {
    state,
    /** False until the current subscription has been read. */
    ready: !supported || subscribed !== undefined,
    busy,
    enable: () => run(enablePush, 'on'),
    disable: () => run(disablePush, 'off'),
  }
}

/** usePushNotifications with toasts for the outcome. */
export function usePushActions() {
  const push = usePushNotifications()
  const enable = () =>
    push
      .enable()
      .then(() => toast.success('Đã bật thông báo trên thiết bị này'))
      .catch((err: unknown) =>
        toast.error('Không bật được thông báo', {
          description: err instanceof Error ? err.message : undefined,
        }),
      )
  const disable = () =>
    push
      .disable()
      .then(() => toast.success('Đã tắt thông báo trên thiết bị này'))
      .catch(() => toast.error('Không tắt được thông báo, thử lại sau.'))
  return { ...push, enable, disable }
}

/**
 * Mounted once inside the app shell: keeps this browser's subscription in
 * line with the logged-in user's choice, and handles messages from
 * public/sw.js — a push arrived (refresh the bell and lists) or a
 * notification was clicked while a tab was open (navigate in place).
 */
export function usePushBridge() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    syncPush(userId)
      .catch((err: unknown) => console.warn('Push sync failed', err))
      .finally(() => void qc.invalidateQueries({ queryKey: SUBSCRIPTION_KEY }))
  }, [userId, qc])

  useEffect(() => {
    if (!isPushSupported()) return
    const onMessage = (event: MessageEvent<{ type?: string; url?: string }>) => {
      if (event.data?.type === 'push') {
        void qc.invalidateQueries({ queryKey: ['notifications'] })
      } else if (event.data?.type === 'navigate' && event.data.url?.startsWith('/')) {
        navigate(event.data.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [qc, navigate])
}
