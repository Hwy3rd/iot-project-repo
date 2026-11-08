import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AlertType } from '../../libs/constants/alert.constant';
import {
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../libs/constants/device.constant';
import { AlertsService } from '../alerts/alerts.service';
import { DeviceStatusHistory } from '../device-status-history/entities/device-status-history.entity';
import { Device } from '../devices/entities/device.entity';

// The board publishes telemetry every ~5 s and every accepted live message
// refreshes last_heartbeat_at (MqttIngestService.recordHeartbeat). Silence
// for this long means the device is gone (power, Wi-Fi, broker).
const DEFAULT_OFFLINE_AFTER_MS = 2 * 60_000;
const SWEEP_INTERVAL_MS = 30_000;

export function offlineAfterMs(raw = process.env.DEVICE_OFFLINE_AFTER_MS) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 30_000
    ? value
    : DEFAULT_OFFLINE_AFTER_MS;
}

// The other half of recordHeartbeat(): that one brings an OFFLINE device
// back to ACTIVE on its next message, this one marks an ACTIVE device
// OFFLINE once its heartbeat has gone stale — history row + OFFLINE alert,
// which recordHeartbeat closes again on recovery. Runs in the `app` process
// only (MqttIngestModule), so there is exactly one sweeper.
@Injectable()
export class DeviceHeartbeatService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(DeviceHeartbeatService.name);
  private readonly offlineAfter = offlineAfterMs();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    private readonly alertsService: AlertsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  sweep(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.markStaleOffline()
      .catch((error: unknown) =>
        this.logger.error(
          'Device heartbeat sweep failed, will retry on next sweep',
          error instanceof Error ? error.stack : error,
        ),
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async markStaleOffline(): Promise<void> {
    const cutoff = new Date(Date.now() - this.offlineAfter);
    // A device claimed but never heard from has no heartbeat: count from
    // its last update (the claim) instead.
    const stale = await this.devicesRepository
      .createQueryBuilder('d')
      .where('d.status = :status', { status: DeviceStatus.ACTIVE })
      .andWhere(
        '(d.lastHeartbeatAt < :cutoff OR (d.lastHeartbeatAt IS NULL AND d.updatedAt < :cutoff))',
        { cutoff },
      )
      .getMany();

    for (const device of stale) {
      if (this.stopping) return;
      try {
        await this.markOffline(device, cutoff);
      } catch (error) {
        this.logger.warn(
          `Could not mark device ${device.uniqueId} offline: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async markOffline(device: Device, cutoff: Date): Promise<void> {
    const changed = await this.devicesRepository.manager.transaction(
      async (manager) => {
        // Conditional on the heartbeat we read: a message that landed in
        // between (recordHeartbeat) wins and the device stays ACTIVE.
        const result = await manager.update(
          Device,
          {
            id: device.id,
            status: DeviceStatus.ACTIVE,
            lastHeartbeatAt: device.lastHeartbeatAt ?? IsNull(),
          },
          { status: DeviceStatus.OFFLINE },
        );
        if (!result.affected) return false;
        await manager.save(
          DeviceStatusHistory,
          manager.create(DeviceStatusHistory, {
            deviceId: device.id,
            oldStatus: DeviceStatus.ACTIVE,
            newStatus: DeviceStatus.OFFLINE,
            trigger: DeviceStatusChangeTrigger.AUTOMATED,
            reason: 'Heartbeat timeout',
          }),
        );
        return true;
      },
    );
    if (!changed) return;

    this.logger.warn(
      `Device ${device.uniqueId} marked offline (last heartbeat ${
        device.lastHeartbeatAt?.toISOString() ?? 'never'
      }, cutoff ${cutoff.toISOString()})`,
    );
    // An unassigned device has no room to alert in; the status is enough.
    if (device.coldRoomId) {
      await this.alertsService.raise({
        type: AlertType.OFFLINE,
        deviceId: device.id,
        coldRoomId: device.coldRoomId,
        details: {
          lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
          offlineAfterMs: this.offlineAfter,
        },
      });
    }
  }
}
