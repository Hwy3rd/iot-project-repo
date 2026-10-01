// Service worker: turns Web Push messages from the alert worker
// (server/src/workers/processors/alert-notification.processor.ts) into
// system notifications, and opens the app on click. Registered by
// src/lib/push.ts. Plain JS, served as-is from public/ (not bundled).
//
// Payload: { title, body, notificationId, alertId }.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const windowClients = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true })

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const url = data.notificationId
    ? `/notifications?open=${encodeURIComponent(data.notificationId)}`
    : '/notifications'

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'ColdChain', {
        body: data.body || '',
        lang: 'vi',
        // One entry per alert: a repeat push replaces it instead of stacking.
        tag: data.alertId || data.notificationId || undefined,
        renotify: Boolean(data.alertId || data.notificationId),
        data: { url },
      })
      // Open tabs refresh the bell / notification list.
      for (const client of await windowClients()) {
        client.postMessage({ type: 'push', notificationId: data.notificationId ?? null })
      }
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/notifications'

  event.waitUntil(
    (async () => {
      const clients = await windowClients()
      const client = clients.find((c) => new URL(c.url).origin === self.location.origin)
      if (client) {
        // Navigate inside the SPA (keeps state, no reload).
        await client.focus()
        client.postMessage({ type: 'navigate', url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
