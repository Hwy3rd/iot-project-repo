import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { User } from '../users/entities/user.entity';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { Alert } from './entities/alert.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, User]),
    // Producer only — this module never processes the queue. The consumer
    // (AlertNotificationProcessor) lives in the worker process and
    // registers the same queue name there; both share the connection
    // BullModule.forRoot() opened in app.module.ts/worker.module.ts.
    BullModule.registerQueue({ name: QUEUE_NAMES.ALERT_NOTIFICATIONS }),
  ],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
