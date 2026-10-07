import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { FanFault } from '../../../libs/constants/device.constant';
import { HydratedDocument } from 'mongoose';
import {
  TELEMETRY_RAW_COLLECTION,
  TELEMETRY_RAW_TTL_DAYS,
} from '../../../libs/constants/telemetry.constant';

// One document per device sample. `deviceId`/`coldRoomId` are plain strings
// pointing at MySQL rows — there is no referential integrity across stores.
@Schema({ collection: TELEMETRY_RAW_COLLECTION, versionKey: false })
export class TelemetryRaw {
  @Prop({ type: String, required: true })
  deviceId!: string;

  // Snapshot of the room the device was assigned to when the sample arrived,
  // so history doesn't change if the device is later moved.
  @Prop({ type: String, required: true })
  coldRoomId!: string;

  // Taken from the device message, not the server clock: a QoS 1 redelivery
  // carries the same `ts`, which is what the unique index dedupes on.
  @Prop({ type: Date, required: true })
  ts!: Date;

  // null when the sensor is faulty.
  @Prop({ type: Number, default: null })
  temperature!: number | null;

  @Prop({ type: Boolean, required: true })
  doorOpen!: boolean;

  @Prop({ type: Boolean, required: true })
  sensorFault!: boolean;

  // Device state reported alongside the reading (see TelemetryMessageDto).
  // null = the device didn't report it (older firmware, simulators), which
  // is also what samples stored before these fields existed read back as.
  @Prop({ type: Number, default: null })
  humidity!: number | null;

  // The fan is actually running (measured supply voltage, firmware v1.3+;
  // the relay state before that).
  @Prop({ type: Boolean, default: null })
  fanOn!: boolean | null;

  @Prop({ type: Boolean, default: null })
  fanRelayOn!: boolean | null;

  @Prop({ type: Number, default: null })
  fanVoltage!: number | null;

  @Prop({ type: Boolean, default: null })
  fanPowerFault!: boolean | null;

  // no_power | low_voltage | high_voltage | stuck_on (FAN_FAULTS)
  @Prop({ type: String, default: null })
  fanFault!: FanFault | null;

  @Prop({ type: Boolean, default: null })
  alarmActive!: boolean | null;

  // Seconds left of a manual command overriding the fan / buzzer; 0 = auto.
  @Prop({ type: Number, default: null })
  fanManualSec!: number | null;

  @Prop({ type: Number, default: null })
  buzzerManualSec!: number | null;

  // The device alarms on the room's thresholds as they were at ingest time
  // (its reported config version matched the room's).
  @Prop({ type: Boolean, default: null })
  configSynced!: boolean | null;

  // Evaluated against the room's temp_min/temp_max at ingest time, because
  // those thresholds can change later.
  @Prop({ type: Boolean, required: true })
  outOfRange!: boolean;
}

export type TelemetryRawDocument = HydratedDocument<TelemetryRaw>;

export const TelemetryRawSchema = SchemaFactory.createForClass(TelemetryRaw);

TelemetryRawSchema.index({ deviceId: 1, ts: 1 }, { unique: true });
// Latest sample per room (ColdRoomStatusService): lets $sort + $group/$first
// jump straight to each room's newest document.
TelemetryRawSchema.index({ coldRoomId: 1, ts: -1 });
// Also serves the rollup's `ts` range scan across all devices.
TelemetryRawSchema.index(
  { ts: 1 },
  { expireAfterSeconds: TELEMETRY_RAW_TTL_DAYS * 24 * 60 * 60 },
);
