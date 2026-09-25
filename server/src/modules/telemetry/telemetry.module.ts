import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { Device } from '../devices/entities/device.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { TelemetryController } from './telemetry.controller';
import { TELEMETRY_MODELS } from './telemetry.models';
import { TelemetryService } from './telemetry.service';

// TelemetryRollupService is intentionally not provided here: the rollup only
// runs in the worker process (see src/workers/worker.module.ts).
@Module({
  imports: [
    MongooseModule.forFeature(TELEMETRY_MODELS),
    TypeOrmModule.forFeature([Device]),
    AlertsModule,
    // coldroom:reading pushes to the warehouse room (see REALTIME_EVENTS).
    RealtimeModule,
  ],
  controllers: [TelemetryController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
