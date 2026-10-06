import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import {
  AI_PREDICTION_FEATURE_SCHEMA,
  AI_PREDICTION_HISTORY_MAX_ROWS,
  AI_PREDICTION_MIN_INTERVAL_MS,
  AI_PREDICTION_SAMPLE_MAX_AGE_MS,
  AI_PREDICTION_HISTORY_WINDOW_MS,
  AI_PREDICTION_SUPPORTED_MAX_TEMP,
  AI_PREDICTION_SUPPORTED_MIN_TEMP,
} from '../../libs/constants/ai-prediction.constant';
import { AlertType } from '../../libs/constants/alert.constant';
import { DeviceStatus } from '../../libs/constants/device.constant';
import {
  TELEMETRY_HOURLY_DEFAULT_RANGE_MS,
  TELEMETRY_HOURLY_MAX_RANGE_MS,
  TELEMETRY_RAW_DEFAULT_LIMIT,
  TELEMETRY_RAW_DEFAULT_RANGE_MS,
  TELEMETRY_RAW_MAX_RANGE_MS,
  TELEMETRY_RAW_MAX_LIMIT,
} from '../../libs/constants/telemetry.constant';
import { AlertsService } from '../alerts/alerts.service';
import { AiPredictionService } from '../ai-prediction/ai-prediction.service';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { declaredChannelTypes } from '../device-channels/declared-channels';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { Device } from '../devices/entities/device.entity';
import {
  QueryRawTelemetryDto,
  QueryTelemetryDto,
} from './dto/query-telemetry.dto';
import {
  REALTIME_EVENTS,
  type ColdRoomReadingEvent,
} from '../../libs/constants/realtime.constant';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { samplePredictionHistory } from './prediction-history';
import { TelemetryHourly } from './schemas/telemetry-hourly.schema';
import { TelemetryRaw } from './schemas/telemetry-raw.schema';
import { floorToHour } from './telemetry.util';

export interface TelemetrySample {
  // Timestamp from the device message (see telemetry-raw.schema.ts).
  ts: Date;
  temperature: number | null;
  doorOpen: boolean;
  sensorFault: boolean;
  // Optional device state (see TelemetryMessageDto); omitted = not reported.
  humidity?: number | null;
  fanOn?: boolean | null;
  fanVoltage?: number | null;
  fanPowerFault?: boolean | null;
  alarmActive?: boolean | null;
}

// Stored as-is, except that "not reported" is always null (never
// undefined) and a non-finite number counts as not reported.
const finiteOrNull = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const deviceState = (sample: TelemetrySample) => ({
  humidity: finiteOrNull(sample.humidity),
  fanOn: sample.fanOn ?? null,
  fanVoltage: finiteOrNull(sample.fanVoltage),
  fanPowerFault: sample.fanPowerFault ?? null,
  alarmActive: sample.alarmActive ?? null,
});

const MONGO_DUPLICATE_KEY = 11000;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === MONGO_DUPLICATE_KEY;

interface PredictionInput {
  temperature: number;
  deviceId: string;
  coldRoom: ColdRoom;
  ts: Date;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly predictionsInFlight = new Set<string>();
  private readonly lastPredictionAttempt = new Map<
    string,
    { roomId: string; ts: number }
  >();

  constructor(
    @InjectModel(TelemetryRaw.name)
    private readonly rawModel: Model<TelemetryRaw>,
    @InjectModel(TelemetryHourly.name)
    private readonly hourlyModel: Model<TelemetryHourly>,
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    @InjectRepository(DeviceChannel)
    private readonly channelsRepository: Repository<DeviceChannel>,
    private readonly alertsService: AlertsService,
    private readonly realtime: RealtimeGateway,
    private readonly aiPredictionService: AiPredictionService,
  ) {}

  // Not exposed over HTTP on purpose: it is meant to be called by the MQTT
  // subscriber once that exists. Resolves the device's room and thresholds from
  // MySQL (one query per sample — add a cache if the sample rate makes that
  // matter) and stores one raw sample.
  //
  // Returns `stored: false` for a redelivered sample (same deviceId + ts), so
  // callers can treat MQTT QoS 1 duplicates as a no-op rather than an error.
  async ingest(
    deviceId: string,
    sample: TelemetrySample,
  ): Promise<{ stored: boolean }> {
    const device = await this.devicesRepository.findOne({
      where: { id: deviceId },
      relations: { coldRoom: true },
    });
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }
    if (device.status === DeviceStatus.DECOMMISSIONED || !device.coldRoom) {
      throw new ConflictException(
        `Device ${deviceId} is not assigned to a cold room and cannot report telemetry`,
      );
    }

    // A reading that is missing or not a finite number is treated as a sensor
    // error instead of being rejected, so one bad sample never breaks the
    // pipeline and still shows up in sensorErrorCount.
    const hasValidReading =
      !sample.sensorFault &&
      typeof sample.temperature === 'number' &&
      Number.isFinite(sample.temperature);
    const temperature = hasValidReading ? sample.temperature : null;
    const { tempMin, tempMax } = device.coldRoom;

    const outOfRange =
      temperature !== null && (temperature < tempMin || temperature > tempMax);
    const state = deviceState(sample);

    try {
      await this.rawModel.create({
        deviceId: device.id,
        coldRoomId: device.coldRoom.id,
        ts: sample.ts,
        temperature,
        doorOpen: sample.doorOpen,
        sensorFault: !hasValidReading,
        outOfRange,
        ...state,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // A redelivered sample carries no new information — the alert
        // evaluation below already ran for it the first time.
        return { stored: false };
      }
      throw error;
    }

    if (temperature !== null) {
      await this.evaluateTemperatureAlert({
        deviceId: device.id,
        coldRoom: device.coldRoom,
        temperature,
        outOfRange,
        doorOpen: sample.doorOpen,
      });
      // Already out of range: TEMPERATURE_OUT_OF_RANGE is open, so a
      // forecast of the same breach would only notify people twice.
      if (!outOfRange) {
        this.schedulePrediction({
          deviceId: device.id,
          coldRoom: device.coldRoom,
          ts: sample.ts,
          temperature,
        });
      }
    }
    await this.evaluateFanPowerAlert({
      deviceId: device.id,
      coldRoom: device.coldRoom,
      ...state,
    });
    await this.announceReading({
      warehouseId: device.coldRoom.warehouseId,
      coldRoomId: device.coldRoom.id,
      deviceId: device.id,
      latest: {
        ts: sample.ts,
        temperature,
        doorOpen: sample.doorOpen,
        sensorFault: !hasValidReading,
        outOfRange,
        ...state,
      },
    });
    return { stored: true };
  }

  // DEVICE_FAULT for the fan's power supply, as judged by the device itself
  // (fanPowerFault: the fan is switched on but its supply dropped or spiked).
  // Raised on a fault sample, refreshed with the latest voltage while it
  // lasts, and only cleared by a sample that shows the fan running on a
  // healthy supply — a fan switched off (door open) proves nothing either
  // way, and a device that doesn't report fan state (null) is ignored, so
  // neither closes an open alert. One DEVICE_FAULT per device (see
  // buildActiveKey); `details.kind` says which part failed.
  private async evaluateFanPowerAlert(input: {
    deviceId: string;
    coldRoom: ColdRoom;
    fanOn: boolean | null;
    fanVoltage: number | null;
    fanPowerFault: boolean | null;
  }): Promise<void> {
    const { deviceId, coldRoom, fanOn, fanVoltage, fanPowerFault } = input;

    if (fanPowerFault === true) {
      await this.alertsService.raise({
        coldRoomId: coldRoom.id,
        deviceId,
        type: AlertType.DEVICE_FAULT,
        // Not triggerValue: every alert view formats that as a temperature.
        details: { kind: 'fan_power', fanVoltage },
      });
    } else if (fanPowerFault === false && fanOn === true) {
      await this.alertsService.resolveAuto({
        type: AlertType.DEVICE_FAULT,
        deviceId,
        coldRoomId: coldRoom.id,
        warehouseId: coldRoom.warehouseId,
      });
    }
  }

  // Reacts to a single valid reading: raises/refreshes the alert while out
  // of range, and only clears it once the temperature is back inside the
  // hysteresis band (not merely back inside [tempMin, tempMax]) so it
  // doesn't flap open/closed right at the edge — mirrors the fan's own
  // hysteresis behaviour (see docs/system-design.md §13b). A sensor-fault
  // sample (temperature === null) is skipped entirely: a sensor fault doesn't
  // raise DEVICE_FAULT yet (only the fan supply does, see
  // evaluateFanPowerAlert), and we don't want a fault reading to be misread
  // as "recovered".
  private async evaluateTemperatureAlert(input: {
    deviceId: string;
    coldRoom: ColdRoom;
    temperature: number;
    outOfRange: boolean;
    doorOpen: boolean;
  }): Promise<void> {
    const { deviceId, coldRoom, temperature, outOfRange, doorOpen } = input;
    const { tempMin, tempMax, hysteresis } = coldRoom;

    if (outOfRange) {
      await this.alertsService.raise({
        coldRoomId: coldRoom.id,
        deviceId,
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        triggerValue: temperature,
        threshold: temperature > tempMax ? tempMax : tempMin,
        details: {
          direction: temperature > tempMax ? 'high' : 'low',
          doorOpenAtTrigger: doorOpen,
        },
      });
      return;
    }

    const recovered =
      temperature <= tempMax - hysteresis &&
      temperature >= tempMin + hysteresis;
    if (recovered) {
      await this.alertsService.resolveAuto({
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        deviceId,
        coldRoomId: coldRoom.id,
        warehouseId: coldRoom.warehouseId,
      });
    }
  }

  // Runs the AI forecast in the background: ingest (and with it the realtime
  // push and the device heartbeat in MqttIngestService) never waits on the
  // AI service. At most one forecast per device is in flight — a reading
  // that arrives meanwhile is skipped. Attempts are at most once per minute
  // per device/room to avoid scanning an hour of history every five seconds.
  // Rooms outside the model's trained range get none (see
  // AI_PREDICTION_SUPPORTED_MIN_TEMP).
  private schedulePrediction(input: PredictionInput) {
    const { tempMin, tempMax } = input.coldRoom;
    const supported =
      tempMin >= AI_PREDICTION_SUPPORTED_MIN_TEMP &&
      tempMax <= AI_PREDICTION_SUPPORTED_MAX_TEMP;
    if (!supported || this.predictionsInFlight.has(input.deviceId)) {
      return;
    }
    const lastAttempt = this.lastPredictionAttempt.get(input.deviceId);
    if (
      lastAttempt?.roomId === input.coldRoom.id &&
      input.ts.getTime() - lastAttempt.ts < AI_PREDICTION_MIN_INTERVAL_MS
    ) {
      return;
    }
    this.lastPredictionAttempt.set(input.deviceId, {
      roomId: input.coldRoom.id,
      ts: input.ts.getTime(),
    });
    this.predictionsInFlight.add(input.deviceId);
    void this.evaluatePredictedAlert(input).finally(() =>
      this.predictionsInFlight.delete(input.deviceId),
    );
  }

  // Evaluates AI 15-minute temperature forecast. Stores it for the cold-room
  // chart, raises TEMPERATURE_PREDICTED when an upcoming breach is forecast
  // and auto-resolves it once the forecast is back inside the hysteresis
  // band — same rule as TEMPERATURE_OUT_OF_RANGE, so a forecast hovering at
  // a threshold doesn't reopen (and re-notify) the alert on every reading.
  // Never throws.
  private async evaluatePredictedAlert(input: PredictionInput): Promise<void> {
    const { deviceId, coldRoom } = input;
    const { tempMin, tempMax, hysteresis } = coldRoom;

    try {
      const history = await this.predictionHistory(input);
      if (!history) {
        return;
      }

      const prediction = await this.aiPredictionService.predict({
        feature_schema: AI_PREDICTION_FEATURE_SCHEMA,
        temperature: input.temperature,
        temperature_history: history,
        temp_min: tempMin,
        temp_max: tempMax,
      });

      if (!prediction) {
        return;
      }

      await this.aiPredictionService.saveLatest(
        coldRoom.id,
        deviceId,
        prediction,
      );

      if (prediction.will_exceed_threshold) {
        await this.alertsService.raise({
          coldRoomId: coldRoom.id,
          deviceId,
          type: AlertType.TEMPERATURE_PREDICTED,
          triggerValue: prediction.predicted_temp_15m,
          threshold:
            prediction.violation_type === 'OVERHEAT' ? tempMax : tempMin,
          details: {
            predictedTemp15m: prediction.predicted_temp_15m,
            violationType: prediction.violation_type,
            riskLevel: prediction.risk_level,
            recommendation: prediction.recommendation,
          },
        });
        return;
      }

      const predicted = prediction.predicted_temp_15m;
      const recovered =
        predicted <= tempMax - hysteresis && predicted >= tempMin + hysteresis;
      if (recovered) {
        await this.alertsService.resolveAuto({
          type: AlertType.TEMPERATURE_PREDICTED,
          deviceId,
          coldRoomId: coldRoom.id,
          warehouseId: coldRoom.warehouseId,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to evaluate AI predicted alert for device ${deviceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Same device and room, using the existing {deviceId, ts} index. The extra
  // minute permits a slightly delayed reading at the t-60 checkpoint.
  private async predictionHistory(input: PredictionInput) {
    const { deviceId, coldRoom, ts, temperature } = input;
    const rows = await this.rawModel
      .find(
        {
          deviceId,
          coldRoomId: coldRoom.id,
          ts: {
            $gte: new Date(
              ts.getTime() -
                AI_PREDICTION_HISTORY_WINDOW_MS -
                AI_PREDICTION_SAMPLE_MAX_AGE_MS,
            ),
            $lte: ts,
          },
          sensorFault: false,
          temperature: { $ne: null },
        },
        { temperature: 1, ts: 1 },
      )
      .sort({ ts: -1 })
      .limit(AI_PREDICTION_HISTORY_MAX_ROWS)
      .lean()
      .exec();
    return samplePredictionHistory(rows, ts, temperature);
  }

  // Live update for open cold-room/warehouse grids. Best effort: the sample
  // is already stored, and the grids also poll, so a failed push is only
  // logged.
  private async announceReading(
    event: Omit<ColdRoomReadingEvent, 'latest'> & {
      latest: Omit<ColdRoomReadingEvent['latest'], 'declaredChannels'>;
    },
  ) {
    try {
      const declared = await declaredChannelTypes(this.channelsRepository, [
        event.deviceId,
      ]);
      this.realtime.emitToWarehouse(
        event.warehouseId,
        REALTIME_EVENTS.COLD_ROOM_READING,
        {
          ...event,
          latest: {
            ...event.latest,
            declaredChannels: declared.get(event.deviceId) ?? [],
          },
        } satisfies ColdRoomReadingEvent,
      );
    } catch (error) {
      this.logger.warn(
        `Could not announce reading for cold room ${event.coldRoomId}: ${String(error)}`,
      );
    }
  }

  async findHourly(deviceId: string, query: QueryTelemetryDto) {
    await this.assertDeviceExists(deviceId);
    const { from, to } = this.resolveRange(
      query,
      TELEMETRY_HOURLY_DEFAULT_RANGE_MS,
      TELEMETRY_HOURLY_MAX_RANGE_MS,
    );

    // A bucket is identified by its start, so align `from` down to the hour
    // to include the bucket that `from` falls inside.
    return this.hourlyModel
      .find({
        deviceId,
        hourBucket: { $gte: floorToHour(from), $lt: to },
      })
      .sort({ hourBucket: 1 })
      .lean()
      .exec();
  }

  // Whole-range statistics plus an adaptive, bounded time series.
  async findHourlySummary(
    deviceId: string,
    query: QueryTelemetryDto,
    maxPoints: number,
    timeZone: string,
  ) {
    await this.assertDeviceExists(deviceId);
    const range = this.resolveRange(
      query,
      TELEMETRY_HOURLY_DEFAULT_RANGE_MS,
      TELEMETRY_HOURLY_MAX_RANGE_MS,
    );
    const from = floorToHour(range.from),
      to = range.to;
    if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 100) {
      throw new BadRequestException('maxPoints must be between 1 and 100');
    }
    const hours = Math.ceil((to.getTime() - from.getTime()) / 3_600_000);
    const unit =
      hours <= maxPoints
        ? 'hour'
        : Math.ceil(hours / 24) + 1 <= maxPoints
          ? 'day'
          : 'month';
    const groupStats = {
      sampleCount: { $sum: '$sampleCount' },
      weightedTemp: {
        $sum: { $multiply: [{ $ifNull: ['$avgTemp', 0] }, '$sampleCount'] },
      },
      minTemp: { $min: '$minTemp' },
      maxTemp: { $max: '$maxTemp' },
      outOfRangeCount: { $sum: '$outOfRangeCount' },
      sensorErrorCount: { $sum: '$sensorErrorCount' },
      doorOpenCount: { $sum: '$doorOpenCount' },
      doorKnownBuckets: {
        $sum: { $cond: [{ $isNumber: '$doorOpenCount' }, 1, 0] },
      },
      sourceBuckets: { $sum: 1 },
    };
    const stats = {
      _id: 0,
      sampleCount: 1,
      minTemp: 1,
      maxTemp: 1,
      outOfRangeCount: 1,
      sensorErrorCount: 1,
      sourceBuckets: 1,
      doorOpenCount: {
        $cond: [{ $gt: ['$doorKnownBuckets', 0] }, '$doorOpenCount', null],
      },
      avgTemp: {
        $cond: [
          { $gt: ['$sampleCount', 0] },
          { $divide: ['$weightedTemp', '$sampleCount'] },
          null,
        ],
      },
    };
    // The summary facet covers every matching hour, before any series limit.
    const [result] = await this.hourlyModel
      .aggregate<{
        summary: Record<string, unknown>[];
        readings: Record<string, unknown>[];
      }>([
        { $match: { deviceId, hourBucket: { $gte: from, $lt: to } } },
        {
          $facet: {
            summary: [
              { $group: { _id: null, ...groupStats } },
              { $project: stats },
            ],
            readings: [
              {
                $group: {
                  _id: {
                    $dateTrunc: {
                      date: '$hourBucket',
                      unit,
                      timezone: timeZone,
                    },
                  },
                  ...groupStats,
                },
              },
              { $project: { ...stats, hourBucket: '$_id' } },
              { $sort: { hourBucket: 1 } },
              { $limit: maxPoints + 1 },
            ],
          },
        },
      ])
      .exec();
    const rows = result?.readings ?? [];
    const hasMore = rows.length > maxPoints;
    return {
      from,
      to,
      bucketUnit: unit,
      timeZone,
      summary: result?.summary[0] ?? null,
      readings: rows.slice(0, maxPoints),
      ...(hasMore
        ? {
            note: 'Chuỗi thời gian chỉ có một phần điểm; summary vẫn tính trên toàn khoảng thời gian được truy vấn.',
          }
        : {}),
    };
  }

  // Oldest-first and capped: page forward by moving from when more samples exist.
  async findRaw(deviceId: string, query: QueryRawTelemetryDto) {
    await this.assertDeviceExists(deviceId);
    const { from, to } = this.resolveRange(
      query,
      TELEMETRY_RAW_DEFAULT_RANGE_MS,
      TELEMETRY_RAW_MAX_RANGE_MS,
    );

    const requestedLimit = query.limit ?? TELEMETRY_RAW_DEFAULT_LIMIT;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }
    return this.rawModel
      .find({ deviceId, ts: { $gte: from, $lt: to } })
      .sort({ ts: 1 })
      .limit(Math.min(requestedLimit, TELEMETRY_RAW_MAX_LIMIT))
      .lean()
      .exec();
  }

  async findLatest(deviceId: string) {
    await this.assertDeviceExists(deviceId);
    return this.rawModel.findOne({ deviceId }).sort({ ts: -1 }).lean().exec();
  }

  private async assertDeviceExists(deviceId: string) {
    const exists = await this.devicesRepository.existsBy({ id: deviceId });
    if (!exists) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }
  }

  private resolveRange(
    query: QueryTelemetryDto,
    defaultRangeMs: number,
    maxRangeMs: number,
  ) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - defaultRangeMs);

    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new BadRequestException('from and to must be valid dates');
    }
    if (from >= to) {
      throw new BadRequestException('from must be before to');
    }
    if (to.getTime() - from.getTime() > maxRangeMs) {
      throw new BadRequestException(
        `Time range must not exceed ${Math.round(maxRangeMs / 3_600_000)} hours`,
      );
    }
    return { from, to };
  }
}
