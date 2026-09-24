import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { FindOptionsWhere, In, QueryFailedError, Repository } from 'typeorm';
import {
  AlertResolution,
  AlertStatus,
  AlertType,
} from '../../libs/constants/alert.constant';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { QueryAlertDto } from './dto/query-alert.dto';
import { Alert } from './entities/alert.entity';
import { buildActiveKey } from './alerts.util';

export interface RaiseAlertInput {
  coldRoomId: string;
  deviceId?: string | null;
  batchId?: string | null;
  type: AlertType;
  triggerValue?: number | null;
  threshold?: number | null;
  details?: Record<string, unknown> | null;
}

export interface AutoResolveCriteria {
  type: AlertType;
  deviceId?: string | null;
  batchId?: string | null;
}

const isMysqlDuplicateKeyError = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY';

// Not exposed over HTTP — called by whatever detects an incident
// (TelemetryService.ingest today; door/offline/batch jobs once that
// infrastructure exists). The two mutating HTTP endpoints
// (acknowledge/resolveManual) are the only ones a person can call.
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert)
    private readonly alertsRepository: Repository<Alert>,
    @InjectQueue(QUEUE_NAMES.ALERT_NOTIFICATIONS)
    private readonly notificationsQueue: Queue,
  ) {}

  // Opens a new alert for (type, device|batch), or — if one is already
  // open/acknowledged for the same incident — refreshes it with the latest
  // observed value instead of creating a second row. Relies on the UNIQUE
  // index on active_key rather than a check-then-insert, so two callers
  // racing on the same incident can't both create a row (see alerts.util.ts).
  //
  // Note: on a refresh, triggerValue/details are overwritten with the latest
  // sample, not merged into a running peak — a caller that wants "worst value
  // so far" must compare against the existing row itself before calling this.
  async raise(input: RaiseAlertInput): Promise<Alert> {
    const subjectId = input.deviceId ?? input.batchId;
    if (!subjectId) {
      // Programmer error — every caller must resolve a device or a batch
      // before raising, this can never come from user input.
      throw new Error('raise() requires deviceId or batchId');
    }
    const activeKey = buildActiveKey(input.type, subjectId);

    try {
      const alert = this.alertsRepository.create({
        coldRoomId: input.coldRoomId,
        deviceId: input.deviceId ?? null,
        batchId: input.batchId ?? null,
        type: input.type,
        status: AlertStatus.OPEN,
        activeKey,
        triggerValue: input.triggerValue ?? null,
        threshold: input.threshold ?? null,
        details: input.details ?? null,
      });
      const saved = await this.alertsRepository.save(alert);
      // Only for a genuinely new incident — a refresh (the catch branch
      // below) means recipients were already notified once for this one.
      await this.enqueueNotification(saved.id);
      return saved;
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) {
        throw error;
      }
      // Fetch-and-save rather than .update(): TypeORM's QueryDeepPartialEntity
      // typing for .update() can't express a plain `json` column value.
      const existing = await this.findByActiveKey(activeKey);
      existing.triggerValue = input.triggerValue ?? null;
      existing.details = input.details ?? null;
      return this.alertsRepository.save(existing);
    }
  }

  // Idempotent no-op when nothing is open for this incident — callers run
  // this on every "condition is fine" observation, not just the first one
  // after an alert closes.
  async resolveAuto(criteria: AutoResolveCriteria): Promise<void> {
    const subjectId = criteria.deviceId ?? criteria.batchId;
    if (!subjectId) {
      throw new Error('resolveAuto() requires deviceId or batchId');
    }
    await this.alertsRepository.update(
      { activeKey: buildActiveKey(criteria.type, subjectId) },
      {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        resolution: AlertResolution.AUTO,
        activeKey: null,
      },
    );
  }

  // Atomic conditional update (not find-then-save) so two people
  // acknowledging the same alert at once can't both "succeed".
  // acknowledgedBy: the authenticated user, or null for an automated caller
  // — never client-supplied (see AlertsController).
  async acknowledge(
    id: string,
    acknowledgedBy: string | null = null,
  ): Promise<Alert> {
    const result = await this.alertsRepository.update(
      { id, status: AlertStatus.OPEN },
      {
        status: AlertStatus.ACKNOWLEDGED,
        acknowledgedBy,
        acknowledgedAt: new Date(),
      },
    );
    if (!result.affected) {
      const alert = await this.findOne(id);
      throw new ConflictException(
        `Alert ${id} cannot be acknowledged from status ${alert.status}`,
      );
    }
    return this.findOne(id);
  }

  // TODO(alerts): for types with an auto-close condition (temperature, door,
  // offline), this should reject with 409 while the condition is still
  // active and only let acknowledge stand — see docs/system-design.md
  // "câu hỏi 1". Deferred until there's a live-state read (Redis
  // device:latest/door:open) to check against; doing it only for some types
  // today would be an inconsistent half-measure.
  async resolveManual(
    id: string,
    resolvedBy: string | null = null,
  ): Promise<Alert> {
    const result = await this.alertsRepository.update(
      { id, status: In([AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED]) },
      {
        status: AlertStatus.RESOLVED,
        resolvedBy,
        resolvedAt: new Date(),
        resolution: AlertResolution.MANUAL,
        activeKey: null,
      },
    );
    if (!result.affected) {
      const alert = await this.findOne(id);
      throw new ConflictException(
        `Alert ${id} cannot be resolved from status ${alert.status}`,
      );
    }
    return this.findOne(id);
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  async findAll(
    query: QueryAlertDto = {},
    access?: WarehouseAccess,
  ): Promise<Paginated<Alert>> {
    const where: FindOptionsWhere<Alert> = {};
    const ids = access?.warehouseIds;
    if (ids) {
      if (ids.length === 0) return Paginated.empty(query);
      where.coldRoom = { warehouseId: In(ids) };
    }
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.coldRoomId) where.coldRoomId = query.coldRoomId;
    if (query.deviceId) where.deviceId = query.deviceId;
    if (query.batchId) where.batchId = query.batchId;

    const pagination = resolvePagination(query);
    const [items, total] = await this.alertsRepository.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string): Promise<Alert> {
    const alert = await this.alertsRepository.findOne({ where: { id } });
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    return alert;
  }

  private async findByActiveKey(activeKey: string): Promise<Alert> {
    const alert = await this.alertsRepository.findOne({
      where: { activeKey },
    });
    if (!alert) {
      // Only reachable if the row was resolved between the failed insert
      // and this read — vanishingly unlikely, but fail loudly rather than
      // silently returning nothing.
      throw new ConflictException(
        `Alert with active key ${activeKey} was resolved concurrently`,
      );
    }
    return alert;
  }

  // Best-effort: a notification job failing to enqueue (e.g. Redis briefly
  // unreachable) must not fail the alert itself — the alert row is the
  // source of truth, the push is a convenience on top of it.
  private async enqueueNotification(alertId: string): Promise<void> {
    try {
      await this.notificationsQueue.add('notify', { alertId });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue notification for alert ${alertId}: ${(error as Error).message}`,
      );
    }
  }
}
