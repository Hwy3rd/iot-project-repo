import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { TELEMETRY_HOURLY_COLLECTION } from '../../../libs/constants/telemetry.constant';

// One document per (device, hour), written only by the rollup job's `$merge`
// (see TelemetryRollupService) — never by the request path. Kept forever.
@Schema({ collection: TELEMETRY_HOURLY_COLLECTION, versionKey: false })
export class TelemetryHourly {
  @Prop({ type: String, required: true })
  deviceId!: string;

  // Room the device was in at the last sample of the hour.
  @Prop({ type: String, required: true })
  coldRoomId!: string;

  // Start of the hour, UTC.
  @Prop({ type: Date, required: true })
  hourBucket!: Date;

  // Samples with a valid temperature. Needed to combine hours correctly
  // (averaging averages is wrong when hours have different sample counts) and,
  // together with sensorErrorCount, to see how complete the hour's data is.
  @Prop({ type: Number, required: true })
  sampleCount!: number;

  // avg/min/max are null when the hour has no valid reading (sampleCount = 0).
  @Prop({ type: Number, default: null })
  avgTemp!: number | null;

  @Prop({ type: Number, default: null })
  minTemp!: number | null;

  @Prop({ type: Number, default: null })
  maxTemp!: number | null;

  @Prop({ type: Number, required: true })
  outOfRangeCount!: number;

  @Prop({ type: Number, required: true })
  sensorErrorCount!: number;

  @Prop({ type: Date, required: true })
  computedAt!: Date;
}

export type TelemetryHourlyDocument = HydratedDocument<TelemetryHourly>;

export const TelemetryHourlySchema =
  SchemaFactory.createForClass(TelemetryHourly);

// `$merge` requires a unique index on its `on` fields; it is also the index
// the hourly read API uses.
TelemetryHourlySchema.index({ deviceId: 1, hourBucket: 1 }, { unique: true });
