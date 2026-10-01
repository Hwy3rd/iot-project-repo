import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MqttClient } from 'mqtt';
import { Repository } from 'typeorm';
import { AlertType } from '../../libs/constants/alert.constant';
import {
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../libs/constants/device.constant';
import { MQTT_CLIENT } from '../../libs/mqtt/mqtt.constant';
import { AlertsService } from '../alerts/alerts.service';
import { DeviceStatusHistory } from '../device-status-history/entities/device-status-history.entity';
import { Device } from '../devices/entities/device.entity';
import { TelemetryService } from '../telemetry/telemetry.service';
import { TelemetryMessageDto } from './dto/telemetry-message.dto';
import {
  DEVICE_TELEMETRY_TOPIC_FILTER,
  parseDeviceUniqueIdFromTopic,
} from './mqtt-ingest.constant';

// Bridges the MQTT broker to TelemetryService.ingest(), which was written to
// be called from exactly this kind of subscriber (see its own comment) but
// had no caller until now. Runs in the `app` process, not `worker` — it
// needs TelemetryModule/AlertsModule wired up as-is, which WorkerModule
// deliberately doesn't import (see docs/ARCHITECTURE.md §1).
@Injectable()
export class MqttIngestService implements OnModuleInit {
  private readonly logger = new Logger(MqttIngestService.name);

  constructor(
    @Inject(MQTT_CLIENT) private readonly mqttClient: MqttClient,
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    private readonly telemetryService: TelemetryService,
    private readonly alertsService: AlertsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // `mqtt`'s 'message' event expects a void-returning listener and never
    // awaits it — each message is processed independently, a failure on one
    // never blocks the next, so the promise is deliberately not returned
    // from here (only awaited internally via handleMessage/.catch()).
    this.mqttClient.on('message', (topic, payload) => {
      void this.handleMessage(topic, payload).catch((error: unknown) =>
        this.logger.error(
          `Unhandled error processing message on topic ${topic}`,
          error instanceof Error ? error.stack : error,
        ),
      );
    });

    await this.mqttClient.subscribeAsync(DEVICE_TELEMETRY_TOPIC_FILTER, {
      qos: 1,
    });
    this.logger.log(`Subscribed to ${DEVICE_TELEMETRY_TOPIC_FILTER}`);
  }

  // Public so it can be exercised directly in tests without going through
  // the mqtt client's event-emitter plumbing.
  async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const uniqueId = parseDeviceUniqueIdFromTopic(topic);
    if (!uniqueId) {
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn(`Ignoring non-JSON message on ${topic}`);
      return;
    }

    const message = plainToInstance(TelemetryMessageDto, raw);
    const errors = validateSync(message);
    if (errors.length > 0) {
      this.logger.warn(
        `Ignoring invalid telemetry payload from device ${uniqueId}: ${errors
          .map((e) => Object.values(e.constraints ?? {}).join(', '))
          .join('; ')}`,
      );
      return;
    }

    const device = await this.devicesRepository.findOne({
      where: { uniqueId },
    });
    if (!device) {
      this.logger.warn(`Ignoring telemetry from unknown device ${uniqueId}`);
      return;
    }

    try {
      await this.telemetryService.ingest(device.id, {
        ts: message.ts,
        temperature: message.temperature,
        doorOpen: message.doorOpen,
        sensorFault: message.sensorFault,
      });
      await this.recordHeartbeat(device);
    } catch (error) {
      // A device that isn't claimed into a room yet, or one that was just
      // decommissioned, is an expected condition here (unlike the HTTP
      // ingest path there's no caller to report the rejection back to) —
      // log and move on rather than let one bad device's messages wedge the
      // shared subscription.
      this.logger.warn(
        `Rejected telemetry from device ${uniqueId} (${device.id}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Any accepted message proves the device is alive. Refreshes
  // last_heartbeat_at and brings an OFFLINE device back to ACTIVE (history
  // row in the same transaction, closing its OFFLINE alert). FAULT and
  // MAINTENANCE are deliberately left alone — those are set on purpose and
  // a telemetry message doesn't clear them. Best effort: the sample is
  // already stored, so a failure here is only logged.
  private async recordHeartbeat(device: Device): Promise<void> {
    try {
      const recovered = device.status === DeviceStatus.OFFLINE;
      await this.devicesRepository.manager.transaction(async (manager) => {
        await manager.update(Device, device.id, {
          lastHeartbeatAt: new Date(),
          ...(recovered ? { status: DeviceStatus.ACTIVE } : {}),
        });
        if (recovered) {
          await manager.save(
            DeviceStatusHistory,
            manager.create(DeviceStatusHistory, {
              deviceId: device.id,
              oldStatus: DeviceStatus.OFFLINE,
              newStatus: DeviceStatus.ACTIVE,
              trigger: DeviceStatusChangeTrigger.AUTOMATED,
              reason: 'Telemetry received',
            }),
          );
        }
      });
      if (recovered) {
        await this.alertsService.resolveAuto({
          type: AlertType.OFFLINE,
          deviceId: device.id,
          coldRoomId: device.coldRoomId ?? undefined,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not record heartbeat for device ${device.uniqueId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
