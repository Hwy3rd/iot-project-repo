import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { dataSourceOptions } from './database/data-source';
import { RedisModule } from './libs/redis/redis.module';
import { MinioModule } from './libs/minio/minio.module';
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
      },
    }),
    RedisModule,
    MinioModule,
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
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
