import { Inject, Injectable } from '@nestjs/common';
import type webpush from 'web-push';
import { WEB_PUSH_CLIENT } from './web-push.constant';

// Deliberately a plain shape, not the PushSubscription TypeORM entity — libs/
// stays generic and doesn't import from modules/.
export interface WebPushSubscriptionInfo {
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

// Alerts are time-critical: ask the push service to wake the device now
// ('high' urgency), but drop a message it couldn't deliver within 6 hours —
// by then the alert is better read in the app than popped up as news.
const SEND_OPTIONS: webpush.RequestOptions = {
  TTL: 6 * 60 * 60,
  urgency: 'high',
};

@Injectable()
export class WebPushService {
  constructor(
    @Inject(WEB_PUSH_CLIENT) private readonly client: typeof webpush,
  ) {}

  send(
    subscription: WebPushSubscriptionInfo,
    payload: string,
  ): Promise<unknown> {
    return this.client.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
      },
      payload,
      SEND_OPTIONS,
    );
  }

  // The push service returns 404/410 once a subscription is gone for good
  // (browser unsubscribed, site data cleared, endpoint expired) — the caller
  // should delete it. Any other error (network blip, a transient 5xx) is
  // left alone for the next alert to retry against the same subscription.
  isGone(error: unknown): boolean {
    const statusCode = (error as { statusCode?: number } | null)?.statusCode;
    return statusCode === 404 || statusCode === 410;
  }
}
