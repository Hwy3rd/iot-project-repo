import { ModelDefinition } from '@nestjs/mongoose';
import {
  TelemetryHourly,
  TelemetryHourlySchema,
} from './schemas/telemetry-hourly.schema';
import {
  TelemetryRaw,
  TelemetryRawSchema,
} from './schemas/telemetry-raw.schema';

// Shared by TelemetryModule (HTTP app) and WorkerModule so both processes
// register exactly the same models.
export const TELEMETRY_MODELS: ModelDefinition[] = [
  { name: TelemetryRaw.name, schema: TelemetryRawSchema },
  { name: TelemetryHourly.name, schema: TelemetryHourlySchema },
];
