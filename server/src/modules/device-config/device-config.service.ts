import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MqttClient } from 'mqtt';
import { In, Repository } from 'typeorm';
import { COMMAND_PUBLISH_TIMEOUT_MS } from '../../libs/constants/command.constant';
import { DeviceStatus } from '../../libs/constants/device.constant';
import { deviceTopic } from '../../libs/mqtt/device-topics';
import { MQTT_CLIENT } from '../../libs/mqtt/mqtt.constant';
import { withTimeout } from '../../libs/mqtt/with-timeout';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { Device } from '../devices/entities/device.entity';

// What a device receives on devices/{uniqueId}/config: the alarm thresholds
// of the room it is installed in, so its local buzzer follows the room's
// settings instead of a value baked into the firmware. `version` is echoed
// back in telemetry (configVersion) to show which settings the device runs.
export interface DeviceConfigMessage {
  version: string;
  tempMin: number;
  tempMax: number;
  hysteresis: number;
  doorOpenMaxSeconds: number;
}

// The room's last change is its config version: any edit to the room moves
// it, and the device only rewrites its flash when the version differs.
export function configVersion(room: ColdRoom): string {
  return room.updatedAt.toISOString();
}

export function buildConfigMessage(room: ColdRoom): DeviceConfigMessage {
  return {
    version: configVersion(room),
    tempMin: room.tempMin,
    tempMax: room.tempMax,
    hysteresis: room.hysteresis,
    doorOpenMaxSeconds: room.doorOpenMaxSeconds,
  };
}

// Keeps each device's retained config message in line with its room. The
// broker holds the last message per topic and hands it to the device as soon
// as it subscribes, so a device that was offline (or rebooted) during a
// change still picks it up — no need to know when it comes back.
//
// An empty retained message clears the topic: sent for a device with no
// live room (unassigned, decommissioned, deleted, or its room deleted), which
// then falls back to the firmware's built-in thresholds.
//
// Never throws: callers are HTTP mutations that already succeeded. A publish
// that fails (broker down) is caught up by the full sync on reconnect.
@Injectable()
export class DeviceConfigService implements OnModuleInit {
  private readonly logger = new Logger(DeviceConfigService.name);

  constructor(
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepository: Repository<ColdRoom>,
    @Inject(MQTT_CLIENT) private readonly mqttClient: MqttClient,
  ) {}

  onModuleInit() {
    // Every (re)connect re-publishes everything: covers changes made while
    // the broker was unreachable, rooms edited outside the API, and a broker
    // that lost its retained messages.
    this.mqttClient.on('connect', () => {
      void this.syncAll();
    });
    if (this.mqttClient.connected) void this.syncAll();
  }

  // After a room's thresholds changed or the room was deleted.
  async publishForRoom(coldRoomId: string): Promise<void> {
    try {
      const devices = await this.devicesRepository.find({
        where: { coldRoomId },
      });
      await this.publishFor(devices);
    } catch (error) {
      this.logWarn(`room ${coldRoomId}`, error);
    }
  }

  // After a device was claimed into a room, decommissioned or deleted.
  async publishForDevice(deviceId: string): Promise<void> {
    try {
      const device = await this.devicesRepository.findOne({
        where: { id: deviceId },
        withDeleted: true,
      });
      if (device) await this.publishFor([device]);
    } catch (error) {
      this.logWarn(`device ${deviceId}`, error);
    }
  }

  async syncAll(): Promise<void> {
    try {
      const devices = await this.devicesRepository.find({ withDeleted: true });
      await this.publishFor(devices);
      this.logger.log(`Synced room config to ${devices.length} device(s)`);
    } catch (error) {
      this.logWarn('all devices', error);
    }
  }

  private async publishFor(devices: Device[]): Promise<void> {
    const roomIds = [
      ...new Set(devices.map((d) => d.coldRoomId).filter((id) => id !== null)),
    ];
    // Soft-deleted rooms are left out, so their devices get cleared.
    const rooms = roomIds.length
      ? await this.coldRoomsRepository.findBy({ id: In(roomIds) })
      : [];
    const roomsById = new Map(rooms.map((r) => [r.id, r]));

    for (const device of devices) {
      const room =
        device.deletedAt || device.status === DeviceStatus.DECOMMISSIONED
          ? undefined
          : roomsById.get(device.coldRoomId ?? '');
      await this.publish(
        device.uniqueId,
        room ? JSON.stringify(buildConfigMessage(room)) : '',
      );
    }
  }

  private async publish(uniqueId: string, payload: string): Promise<void> {
    // Offline, mqtt.js would queue it and could deliver it after a newer
    // config; the sync on reconnect sends the current one instead.
    if (!this.mqttClient.connected) return;
    try {
      await withTimeout(
        this.mqttClient.publishAsync(deviceTopic(uniqueId, 'config'), payload, {
          qos: 1,
          retain: true,
        }),
        COMMAND_PUBLISH_TIMEOUT_MS,
      );
    } catch (error) {
      this.logWarn(`device ${uniqueId}`, error);
    }
  }

  private logWarn(target: string, error: unknown) {
    this.logger.warn(
      `Could not publish room config for ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
