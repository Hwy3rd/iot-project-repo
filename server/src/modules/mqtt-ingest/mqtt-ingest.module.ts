import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../devices/entities/device.entity';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { MqttIngestService } from './mqtt-ingest.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), TelemetryModule],
  providers: [MqttIngestService],
})
export class MqttIngestModule {}
