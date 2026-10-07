import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { FindOptionsWhere, In, Not, Repository } from 'typeorm';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { AlertStatus } from '../../libs/constants/alert.constant';
import { DeviceStatus } from '../../libs/constants/device.constant';
import type { ChannelType } from '../../libs/constants/device-channel.constant';
import { declaredChannelTypes } from '../device-channels/declared-channels';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { Alert } from '../alerts/entities/alert.entity';
import { Device } from '../devices/entities/device.entity';
import { TelemetryRaw } from '../telemetry/schemas/telemetry-raw.schema';
import { QueryColdRoomStatusDto } from './dto/query-cold-room-status.dto';
import type { TelemetryRange } from './dto/query-cold-room-telemetry.dto';
import { ColdRoom } from './entities/cold-room.entity';
import { AiPredictionService } from '../ai-prediction/ai-prediction.service';
import type { ColdRoomPrediction } from '../ai-prediction/dto/ai-prediction.dto';

// A room's rows can span many warehouses when asked by warehouseIds; this
// keeps one response bounded.
const MAX_ROOMS = 500;

export interface ColdRoomLatestReading {
  ts: Date;
  /** The device that sent this sample. */
  deviceId: string;
  /**
   * Channel types that device declares. The UI shows an optional field only
   * when its channel is declared (TELEMETRY_FIELD_CHANNEL) and flags it when
   * declared but null; [] = nothing declared, shown as-is.
   */
  declaredChannels: ChannelType[];
  temperature: number | null;
  doorOpen: boolean;
  sensorFault: boolean;
  outOfRange: boolean;
  /** Device state with the reading; null when the device doesn't report it. */
  humidity: number | null;
  /** The fan is actually running (measured voltage on firmware v1.3+). */
  fanOn: boolean | null;
  /** The device drives the fan relay on. */
  fanRelayOn: boolean | null;
  fanVoltage: number | null;
  fanPowerFault: boolean | null;
  /** Which supply fault: no_power | low_voltage | high_voltage | stuck_on. */
  fanFault: string | null;
  alarmActive: boolean | null;
  /** Seconds left of a manual command on the fan / buzzer; 0 = automatic. */
  fanManualSec: number | null;
  buzzerManualSec: number | null;
  /** The device alarms on the room's current thresholds. */
  configSynced: boolean | null;
}

// Window length and bucket size per range: ~60-100 points each.
const RANGE_BUCKETS: Record<TelemetryRange, { ms: number; minutes: number }> = {
  '1h': { ms: 60 * 60_000, minutes: 1 },
  '6h': { ms: 6 * 60 * 60_000, minutes: 5 },
  '24h': { ms: 24 * 60 * 60_000, minutes: 15 },
};

export interface ColdRoomSeriesPoint {
  /** Bucket start. */
  t: Date;
  /** Over the bucket's valid readings; null when every sample was faulty. */
  avg: number | null;
  min: number | null;
  max: number | null;
  samples: number;
  /** How many samples in the bucket were out of range / had the door open / a sensor fault. */
  outOfRange: number;
  doorOpen: number;
  sensorFault: number;
  /** Average humidity (%) of the samples that reported one; null if none did. */
  humidity: number | null;
  /** How many samples reported a fan power fault. */
  fanPowerFault: number;
}

export interface ColdRoomSeries {
  coldRoomId: string;
  from: Date;
  to: Date;
  bucketMinutes: number;
  /** Current thresholds, for reference lines (samples were judged at ingest). */
  tempMin: number;
  tempMax: number;
  points: ColdRoomSeriesPoint[];
  /** Latest AI forecast stored at ingest; null when none is recent enough. */
  prediction: ColdRoomPrediction | null;
}

export interface ColdRoomStatus {
  coldRoomId: string;
  warehouseId: string;
  /** Most recent sample from any device in the room; null if none kept. */
  latest: ColdRoomLatestReading | null;
  /** Devices currently installed in the room, by status. */
  devices: { total: number } & Partial<Record<DeviceStatus, number>>;
  /** Alerts still open or acknowledged (not yet resolved). */
  activeAlerts: number;
}

// Live overview for the cold-room/warehouse grids: one latest reading +
// device and alert counts per room, in three queries whatever the number of
// rooms (one Mongo aggregation, two grouped SQL counts).
@Injectable()
export class ColdRoomStatusService {
  constructor(
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepository: Repository<ColdRoom>,
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    @InjectRepository(Alert)
    private readonly alertsRepository: Repository<Alert>,
    @InjectRepository(DeviceChannel)
    private readonly channelsRepository: Repository<DeviceChannel>,
    @InjectModel(TelemetryRaw.name)
    private readonly rawModel: Model<TelemetryRaw>,
    private readonly aiPredictionService: AiPredictionService,
  ) {}

  async findStatuses(
    query: QueryColdRoomStatusDto,
    access: WarehouseAccess,
  ): Promise<ColdRoomStatus[]> {
    if (!query.coldRoomIds?.length && !query.warehouseIds?.length) {
      throw new BadRequestException(
        'Pass coldRoomIds or warehouseIds to choose the rooms',
      );
    }
    const scope = access.warehouseIds;
    if (scope?.length === 0) return [];

    const where: FindOptionsWhere<ColdRoom> = {};
    if (query.coldRoomIds?.length) where.id = In(query.coldRoomIds);
    const warehouseIds = query.warehouseIds?.length
      ? query.warehouseIds.filter((id) => !scope || scope.includes(id))
      : scope;
    if (warehouseIds) {
      if (warehouseIds.length === 0) return [];
      where.warehouseId = In(warehouseIds);
    }
    const rooms = await this.coldRoomsRepository.find({
      where,
      select: { id: true, warehouseId: true },
      take: MAX_ROOMS,
    });
    if (rooms.length === 0) return [];
    const roomIds = rooms.map((r) => r.id);

    const [latest, devices, alerts] = await Promise.all([
      this.latestReadings(roomIds),
      this.deviceCounts(roomIds),
      this.activeAlertCounts(roomIds),
    ]);

    return rooms.map((room) => ({
      coldRoomId: room.id,
      warehouseId: room.warehouseId,
      latest: latest.get(room.id) ?? null,
      devices: devices.get(room.id) ?? { total: 0 },
      activeAlerts: alerts.get(room.id) ?? 0,
    }));
  }

  // Temperature history of one room, bucketed for a chart: every device's
  // samples in the room pooled together (like `latest` above). Uses the
  // { coldRoomId, ts } index for the range scan. Empty buckets are simply
  // absent — the chart shows a gap rather than inventing values.
  async findSeries(
    coldRoomId: string,
    range: TelemetryRange = '6h',
  ): Promise<ColdRoomSeries> {
    const room = await this.coldRoomsRepository.findOne({
      where: { id: coldRoomId },
      select: { id: true, tempMin: true, tempMax: true },
    });
    if (!room) throw new NotFoundException(`Cold room ${coldRoomId} not found`);

    const { ms, minutes } = RANGE_BUCKETS[range];
    const to = new Date();
    const from = new Date(to.getTime() - ms);
    const rows = await this.rawModel.aggregate<
      Omit<ColdRoomSeriesPoint, 't'> & { _id: Date }
    >([
      { $match: { coldRoomId, ts: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: {
            $dateTrunc: { date: '$ts', unit: 'minute', binSize: minutes },
          },
          // $avg/$min/$max skip nulls, i.e. sensor-fault samples.
          avg: { $avg: '$temperature' },
          min: { $min: '$temperature' },
          max: { $max: '$temperature' },
          samples: { $sum: 1 },
          outOfRange: { $sum: { $cond: ['$outOfRange', 1, 0] } },
          doorOpen: { $sum: { $cond: ['$doorOpen', 1, 0] } },
          sensorFault: { $sum: { $cond: ['$sensorFault', 1, 0] } },
          // Skips samples that didn't report humidity (null/missing).
          humidity: { $avg: '$humidity' },
          fanPowerFault: { $sum: { $cond: ['$fanPowerFault', 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Computed at ingest (TelemetryService) — never calls the AI service
    // here, so the chart doesn't wait on it.
    const prediction = await this.aiPredictionService.getLatest(coldRoomId);

    return {
      coldRoomId,
      from,
      to,
      bucketMinutes: minutes,
      tempMin: room.tempMin,
      tempMax: room.tempMax,
      points: rows.map(({ _id, avg, humidity, ...rest }) => ({
        t: _id,
        avg: avg === null ? null : Math.round(avg * 100) / 100,
        humidity:
          typeof humidity === 'number' ? Math.round(humidity * 10) / 10 : null,
        ...rest,
      })),
      prediction,
    };
  }

  // $sort on the { coldRoomId, ts } index then $group/$first lets Mongo
  // jump to each room's newest sample instead of scanning its history.
  // Only devices installed in the room now count: samples a device sent
  // before it was moved elsewhere (or decommissioned) stay in the room's
  // history but no longer describe the room.
  private async latestReadings(roomIds: string[]) {
    const installed = await this.devicesRepository.find({
      where: {
        coldRoomId: In(roomIds),
        status: Not(DeviceStatus.DECOMMISSIONED),
      },
      select: { id: true, coldRoomId: true },
    });
    if (installed.length === 0) return new Map<string, ColdRoomLatestReading>();
    const rows = await this.rawModel.aggregate<
      Omit<ColdRoomLatestReading, 'declaredChannels'> & { _id: string }
    >([
      // Paired per room: a device installed in one of these rooms must not
      // bring in what it sent from another one.
      {
        $match: {
          $or: installed.map((d) => ({
            coldRoomId: d.coldRoomId,
            deviceId: d.id,
          })),
        },
      },
      { $sort: { coldRoomId: 1, ts: -1 } },
      {
        $group: {
          _id: '$coldRoomId',
          ts: { $first: '$ts' },
          deviceId: { $first: '$deviceId' },
          temperature: { $first: '$temperature' },
          doorOpen: { $first: '$doorOpen' },
          sensorFault: { $first: '$sensorFault' },
          outOfRange: { $first: '$outOfRange' },
          humidity: { $first: '$humidity' },
          fanOn: { $first: '$fanOn' },
          fanRelayOn: { $first: '$fanRelayOn' },
          fanVoltage: { $first: '$fanVoltage' },
          fanPowerFault: { $first: '$fanPowerFault' },
          fanFault: { $first: '$fanFault' },
          alarmActive: { $first: '$alarmActive' },
          fanManualSec: { $first: '$fanManualSec' },
          buzzerManualSec: { $first: '$buzzerManualSec' },
          configSynced: { $first: '$configSynced' },
        },
      },
    ]);
    const declared = await declaredChannelTypes(this.channelsRepository, [
      ...new Set(rows.map((r) => r.deviceId)),
    ]);
    // `?? null`: samples stored before these fields existed lack them.
    return new Map(
      rows.map(({ _id, ...reading }) => [
        _id,
        {
          ...reading,
          declaredChannels: declared.get(reading.deviceId) ?? [],
          humidity: reading.humidity ?? null,
          fanOn: reading.fanOn ?? null,
          fanRelayOn: reading.fanRelayOn ?? null,
          fanVoltage: reading.fanVoltage ?? null,
          fanPowerFault: reading.fanPowerFault ?? null,
          fanFault: reading.fanFault ?? null,
          alarmActive: reading.alarmActive ?? null,
          fanManualSec: reading.fanManualSec ?? null,
          buzzerManualSec: reading.buzzerManualSec ?? null,
          configSynced: reading.configSynced ?? null,
        },
      ]),
    );
  }

  private async deviceCounts(roomIds: string[]) {
    const rows = await this.devicesRepository
      .createQueryBuilder('d')
      .select('d.coldRoomId', 'coldRoomId')
      .addSelect('d.status', 'status')
      .addSelect('COUNT(*)', 'n')
      .where('d.coldRoomId IN (:...roomIds)', { roomIds })
      .groupBy('d.coldRoomId')
      .addGroupBy('d.status')
      .getRawMany<{ coldRoomId: string; status: DeviceStatus; n: string }>();
    const counts = new Map<string, ColdRoomStatus['devices']>();
    for (const { coldRoomId, status, n } of rows) {
      const entry = counts.get(coldRoomId) ?? { total: 0 };
      entry[status] = Number(n);
      entry.total += Number(n);
      counts.set(coldRoomId, entry);
    }
    return counts;
  }

  private async activeAlertCounts(roomIds: string[]) {
    const rows = await this.alertsRepository
      .createQueryBuilder('a')
      .select('a.coldRoomId', 'coldRoomId')
      .addSelect('COUNT(*)', 'n')
      .where('a.coldRoomId IN (:...roomIds)', { roomIds })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED],
      })
      .groupBy('a.coldRoomId')
      .getRawMany<{ coldRoomId: string; n: string }>();
    return new Map(rows.map((r) => [r.coldRoomId, Number(r.n)]));
  }
}
