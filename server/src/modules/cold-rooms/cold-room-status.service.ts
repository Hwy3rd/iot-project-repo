import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { AlertStatus } from '../../libs/constants/alert.constant';
import { DeviceStatus } from '../../libs/constants/device.constant';
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
  temperature: number | null;
  doorOpen: boolean;
  sensorFault: boolean;
  outOfRange: boolean;
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
      points: rows.map(({ _id, avg, ...rest }) => ({
        t: _id,
        avg: avg === null ? null : Math.round(avg * 100) / 100,
        ...rest,
      })),
      prediction,
    };
  }

  // $sort on the { coldRoomId, ts } index then $group/$first lets Mongo
  // jump to each room's newest sample instead of scanning its history.
  private async latestReadings(roomIds: string[]) {
    const rows = await this.rawModel.aggregate<
      ColdRoomLatestReading & { _id: string }
    >([
      { $match: { coldRoomId: { $in: roomIds } } },
      { $sort: { coldRoomId: 1, ts: -1 } },
      {
        $group: {
          _id: '$coldRoomId',
          ts: { $first: '$ts' },
          temperature: { $first: '$temperature' },
          doorOpen: { $first: '$doorOpen' },
          sensorFault: { $first: '$sensorFault' },
          outOfRange: { $first: '$outOfRange' },
        },
      },
    ]);
    return new Map(
      rows.map(
        ({ _id, ts, temperature, doorOpen, sensorFault, outOfRange }) => [
          _id,
          { ts, temperature, doorOpen, sensorFault, outOfRange },
        ],
      ),
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
