import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { NotificationStatus } from '../../libs/constants/notification.constant';
import { WebPushService } from '../../libs/web-push/web-push.service';
import { Alert } from '../../modules/alerts/entities/alert.entity';
import { Notification } from '../../modules/notifications/entities/notification.entity';
import { PushSubscription } from '../../modules/notifications/entities/push-subscription.entity';
import { NotificationsService } from '../../modules/notifications/notifications.service';

export interface AlertNotificationJobData {
  alertId: string;
}

// Consumes jobs enqueued by AlertsService.raise() for a newly opened alert
// (see that file). Two steps per job: resolve who to notify and record it
// (NotificationsService.notifyNewAlert — pure DB work), then actually push
// to each recipient's browser(s) (this class — the part that does network
// I/O and can fail per-subscription).
@Injectable()
@Processor(QUEUE_NAMES.ALERT_NOTIFICATIONS)
export class AlertNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertNotificationProcessor.name);

  constructor(
    @InjectRepository(Alert)
    private readonly alertsRepository: Repository<Alert>,
    @InjectRepository(PushSubscription)
    private readonly subscriptionsRepository: Repository<PushSubscription>,
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    private readonly notificationsService: NotificationsService,
    private readonly webPush: WebPushService,
  ) {
    super();
  }

  async process(job: Job<AlertNotificationJobData>): Promise<void> {
    const alert = await this.alertsRepository.findOne({
      where: { id: job.data.alertId },
    });
    if (!alert) {
      // Alerts are append-only (see alerts.service.ts) — this should never
      // happen, but a job referencing a since-vanished id is nothing to
      // retry over.
      this.logger.warn(`Alert ${job.data.alertId} not found, skipping`);
      return;
    }

    const notifications = await this.notificationsService.notifyNewAlert(alert);
    for (const notification of notifications) {
      await this.deliver(notification);
    }
  }

  private async deliver(notification: Notification): Promise<void> {
    const subscriptions = await this.subscriptionsRepository.find({
      where: { userId: notification.userId },
    });
    if (subscriptions.length === 0) {
      await this.notificationsRepository.update(notification.id, {
        status: NotificationStatus.FAILED,
      });
      return;
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      notificationId: notification.id,
      alertId: notification.alertId,
    });

    // Fan out to every browser this user is subscribed on; the notification
    // as a whole counts as sent once any one of them accepts it.
    let delivered = false;
    for (const subscription of subscriptions) {
      try {
        await this.webPush.send(subscription, payload);
        delivered = true;
        await this.subscriptionsRepository.update(subscription.id, {
          lastUsedAt: new Date(),
        });
      } catch (error) {
        if (this.webPush.isGone(error)) {
          await this.subscriptionsRepository.delete(subscription.id);
        } else {
          this.logger.warn(
            `Push to subscription ${subscription.id} failed: ${(error as Error).message}`,
          );
        }
      }
    }

    await this.notificationsRepository.update(notification.id, {
      status: delivered ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: delivered ? new Date() : null,
    });
  }
}
