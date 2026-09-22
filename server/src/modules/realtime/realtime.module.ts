import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    // A separate JwtModule instance (not AuthModule's) so this stays
    // decoupled from the REST auth module — same JWT_SECRET, verify only
    // (no signOptions needed, this side never issues tokens).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
    TypeOrmModule.forFeature([WarehouseStaff]),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
