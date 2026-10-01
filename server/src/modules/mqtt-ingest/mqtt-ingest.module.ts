import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { Device } from '../devices/entities/device.entity';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { MqttIngestService } from './mqtt-ingest.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), TelemetryModule, AlertsModule],
  providers: [MqttIngestService],
})
export class MqttIngestModule {}
