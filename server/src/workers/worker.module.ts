import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { dataSourceOptions } from '../database/data-source';
import { QUEUE_NAMES } from '../libs/constants/queue.constant';
import { WebPushModule } from '../libs/web-push/web-push.module';
import { Alert } from '../modules/alerts/entities/alert.entity';
import { Batch } from '../modules/batches/entities/batch.entity';
import { ColdRoom } from '../modules/cold-rooms/entities/cold-room.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { PushSubscription } from '../modules/notifications/entities/push-subscription.entity';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { TelemetryRollupService } from '../modules/telemetry/telemetry-rollup.service';
import { TELEMETRY_MODELS } from '../modules/telemetry/telemetry.models';
import { User } from '../modules/users/entities/user.entity';
import { WarehouseStaff } from '../modules/warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../modules/work-shifts/entities/work-shift.entity';
import { AlertNotificationProcessor } from './processors/alert-notification.processor';
import { BatchExpiryProcessor } from './processors/batch-expiry.processor';
import { TelemetryRollupProcessor } from './processors/telemetry-rollup.processor';
import { WorkShiftAbsenceProcessor } from './processors/work-shift-absence.processor';

// Standalone root module for the worker process (see src/workers/main.ts) —
// no HTTP concerns here. Intentionally leaner than AppModule: no MinioModule,
// no feature/controller modules (entities/services are registered directly
// below instead of importing e.g. AlertsModule/NotificationsModule, so their
// controllers never come along for the ride). Mongoose is here only for the
// telemetry rollup job; WebPushModule only for AlertNotificationProcessor.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGO_URI ?? 'mongodb://localhost:27017/iot',
    ),
    MongooseModule.forFeature(TELEMETRY_MODELS),
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      autoLoadEntities: true,
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.BATCH_MAINTENANCE },
      { name: QUEUE_NAMES.WORK_SHIFT_MAINTENANCE },
      { name: QUEUE_NAMES.TELEMETRY_ROLLUP },
      { name: QUEUE_NAMES.ALERT_NOTIFICATIONS },
    ),
    TypeOrmModule.forFeature([
      Batch,
      WorkShift,
      Alert,
      ColdRoom,
      WarehouseStaff,
      User,
      Notification,
      PushSubscription,
    ]),
    WebPushModule,
  ],
  providers: [
    BatchExpiryProcessor,
    WorkShiftAbsenceProcessor,
    TelemetryRollupService,
    TelemetryRollupProcessor,
    NotificationsService,
    AlertNotificationProcessor,
  ],
})
export class WorkerModule {}
