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
