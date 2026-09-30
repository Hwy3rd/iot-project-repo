import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { GlobalExceptionFilter } from './common/fitlers/global-exception.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RbacModule } from './common/rbac/rbac.module';
import { dataSourceOptions } from './database/data-source';
import { RedisModule } from './libs/redis/redis.module';
import { MinioModule } from './libs/minio/minio.module';
import { MqttModule } from './libs/mqtt/mqtt.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { ColdRoomsModule } from './modules/cold-rooms/cold-rooms.module';
import { ProductTypesModule } from './modules/product-types/product-types.module';
import { BatchesModule } from './modules/batches/batches.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { WorkShiftsModule } from './modules/work-shifts/work-shifts.module';
import { DevicesModule } from './modules/devices/devices.module';
import { DeviceChannelsModule } from './modules/device-channels/device-channels.module';
import { CommandsModule } from './modules/commands/commands.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { UploadFilesModule } from './modules/upload-files/upload-files.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DeviceStatusHistoryModule } from './modules/device-status-history/device-status-history.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MqttIngestModule } from './modules/mqtt-ingest/mqtt-ingest.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGO_URI ?? 'mongodb://localhost:27017/iot',
    ),
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      autoLoadEntities: true,
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    RedisModule,
    MinioModule,
    MqttModule,
    RbacModule,
    UsersModule,
    AuthModule,
    WarehousesModule,
    ColdRoomsModule,
    ProductTypesModule,
    BatchesModule,
    ShiftsModule,
    WorkShiftsModule,
    DevicesModule,
    DeviceChannelsModule,
    CommandsModule,
    AuditLogsModule,
    UploadFilesModule,
    TelemetryModule,
    AlertsModule,
    NotificationsModule,
    DeviceStatusHistoryModule,
    RealtimeModule,
    MqttIngestModule,
    ChatbotModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    // No-op unless the handler has @Audit() — see audit.interceptor.ts.
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
