import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { NotificationRecoveryService } from '../../modules/notifications/notification-recovery.service';

export interface AlertNotificationJobData {
  alertId: string;
}

@Processor(QUEUE_NAMES.ALERT_NOTIFICATIONS)
export class AlertNotificationProcessor extends WorkerHost {
  constructor(private readonly recovery: NotificationRecoveryService) {
    super();
  }

  async process(job: Job<AlertNotificationJobData>): Promise<void> {
    await this.recovery.processAlert(job.data.alertId);
    await this.recovery.sweep();
  }
}
