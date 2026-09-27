import { notificationsApi } from '@/api/endpoints'
import { readPreference } from './usePreference'

// Web Push on this device: public/sw.js shows the system notification, the
// backend stores one push_subscriptions row per browser (endpoint) and the
// alert worker pushes to every row of each recipient.
//
// Opt-in is remembered per user in this browser (preference `push:<userId>`),
// so the same person logging back in is re-subscribed without asking again,
// while someone else logging in on the device never gets the previous
// user's alerts: syncPush() drops the browser subscription unless the
// current user turned push on here.

export const pushPreferenceKey = (userId: string) => `push:${userId}`

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Once at startup; harmless when push is unsupported or already registered. */
export function registerServiceWorker() {
  if (!isPushSupported()) return
  navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
    console.warn('Service worker registration failed', err)
  })
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

// VAPID public keys are URL-safe base64; pushManager wants the raw bytes.
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i])

/** Subscribes this browser (reusing a matching subscription) and registers it with the server. */
async function subscribe(): Promise<void> {
  const { publicKey } = await notificationsApi.vapidPublicKey()
  if (!publicKey) throw new Error('Máy chủ chưa cấu hình thông báo đẩy (VAPID).')
  const key = base64UrlToBytes(publicKey)

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  // Subscribed under an older keypair: the push service would reject our sends.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  })

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('Trình duyệt trả về đăng ký thông báo không hợp lệ.')
  }
  await notificationsApi.subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent,
  })
}

/** Asks for permission if needed, then subscribes. Throws with a user-facing message. */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error('Trình duyệt này không hỗ trợ thông báo đẩy.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Bạn đã chặn thông báo cho trang này. Mở cài đặt trang của trình duyệt để cho phép lại.'
        : 'Chưa được cấp quyền hiển thị thông báo.',
    )
  }
  await subscribe()
}

/**
 * Stops pushes to this browser: removes the server row (needs a live
 * session) and the browser subscription itself, which also invalidates the
 * endpoint so a row we couldn't delete is dropped by the worker on its next
 * send (404/410).
 */
export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  await notificationsApi.unsubscribePush(subscription.endpoint).catch(() => undefined)
  await subscription.unsubscribe()
}

/**
 * After login / on app load: make the browser subscription match the
 * current user's choice. Re-registering an existing subscription is an
 * upsert, which also picks up an endpoint the browser rotated.
 */
export async function syncPush(userId: string): Promise<void> {
  if (!isPushSupported()) return
  const wanted = readPreference(pushPreferenceKey(userId)) === 'on' && Notification.permission === 'granted'
  if (wanted) {
    await subscribe()
  } else {
    // Possibly left over from another account on this device.
    const subscription = await currentPushSubscription()
    await subscription?.unsubscribe()
  }
}
