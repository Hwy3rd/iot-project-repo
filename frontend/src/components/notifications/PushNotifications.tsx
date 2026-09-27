import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePushActions, type PushState } from '@/lib/usePushNotifications'
import { BellOff, BellRing, CircleAlert, Loader2 } from 'lucide-react'

const STATE_TEXT: Record<PushState, string> = {
  unsupported:
    'Trình duyệt này không hỗ trợ thông báo đẩy (cần HTTPS; trên iPhone/iPad hãy thêm trang vào Màn hình chính trước).',
  denied: 'Bạn đã chặn thông báo cho trang này. Mở cài đặt trang của trình duyệt để cho phép lại.',
  off: 'Nhận cảnh báo của các kho bạn phụ trách ngay trên thiết bị này, kể cả khi đã đóng tab.',
  on: 'Thiết bị này đang nhận thông báo cảnh báo. Đăng xuất sẽ tạm dừng cho tới lần đăng nhập sau.',
}

/** Profile card: turn push notifications on/off for this browser. */
export function PushNotificationsCard() {
  const push = usePushActions()
  const blocked = push.state === 'unsupported' || push.state === 'denied'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông báo trên thiết bị</CardTitle>
        <CardDescription>Áp dụng riêng cho trình duyệt đang dùng.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {blocked ? (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{STATE_TEXT[push.state]}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground">{STATE_TEXT[push.state]}</p>
        )}
        {!blocked && (
          <div>
            {push.state === 'on' ? (
              <Button variant="outline" onClick={push.disable} disabled={push.busy || !push.ready}>
                {push.busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <BellOff aria-hidden="true" />}
                Tắt thông báo
              </Button>
            ) : (
              <Button onClick={push.enable} disabled={push.busy || !push.ready}>
                {push.busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <BellRing aria-hidden="true" />}
                Bật thông báo
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Header action on the notifications page; only shown while push is off. */
export function EnablePushButton() {
  const push = usePushActions()
  if (!push.ready || push.state !== 'off') return null
  return (
    <Button variant="outline" onClick={push.enable} disabled={push.busy}>
      {push.busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <BellRing aria-hidden="true" />}
      Bật thông báo trên thiết bị
    </Button>
  )
}
