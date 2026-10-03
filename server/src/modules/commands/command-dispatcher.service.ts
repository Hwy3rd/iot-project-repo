import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MqttClient } from 'mqtt';
import { In, Repository } from 'typeorm';
import {
  COMMAND_MAX_ATTEMPTS,
  COMMAND_PUBLISH_TIMEOUT_MS,
  CommandStatus,
  OPEN_COMMAND_STATUSES,
} from '../../libs/constants/command.constant';
import { deviceTopic } from '../../libs/mqtt/device-topics';
import { MQTT_CLIENT } from '../../libs/mqtt/mqtt.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { Command } from './entities/command.entity';

// What the device receives on devices/{uniqueId}/commands. Kept small:
// PubSubClient on the ESP32 has a 512-byte buffer for topic + payload.
// `channel` is the channelType (the firmware maps it to a pin); `label`
// disambiguates two channels of the same type on one board.
export interface CommandMessage {
  id: string;
  channel: string;
  label: string | null;
  action: string;
  expiresAt: string;
}

// Hands commands to the broker. Used by both processes: `app` right after a
// command is created, `worker` (CommandRetryProcessor) to re-publish the
// ones no ack came back for. Never throws — a command that couldn't be
// published simply stays open and the next sweep tries again.
@Injectable()
export class CommandDispatcherService {
  private readonly logger = new Logger(CommandDispatcherService.name);

  constructor(
    @InjectRepository(Command)
    private readonly commandsRepository: Repository<Command>,
    @InjectRepository(DeviceChannel)
    private readonly channelsRepository: Repository<DeviceChannel>,
    @Inject(MQTT_CLIENT) private readonly mqttClient: MqttClient,
  ) {}

  // Returns whether the broker accepted the message (PUBACK received).
  async dispatch(command: Command, now = new Date()): Promise<boolean> {
    if (command.attempts >= COMMAND_MAX_ATTEMPTS) return false;
    // Offline, mqtt.js would queue the message and deliver it whenever it
    // reconnects — possibly after the command expired. Leave it to the
    // sweep, which re-checks expiry first.
    if (!this.mqttClient.connected) return false;

    try {
      const channel = await this.channelsRepository.findOne({
        where: { id: command.channelId },
        relations: { device: true },
      });
      // Soft-deleted device: the relation comes back empty. Nothing to
      // send it to; the command expires on its own.
      if (!channel?.device) {
        this.logger.warn(
          `Command ${command.id}: channel ${command.channelId} has no live device`,
        );
        return false;
      }

      const message: CommandMessage = {
        id: command.id,
        channel: channel.channelType,
        label: channel.label,
        action: command.action,
        expiresAt: command.expiresAt.toISOString(),
      };
      await withTimeout(
        this.mqttClient.publishAsync(
          deviceTopic(channel.device.uniqueId, 'commands'),
          JSON.stringify(message),
          { qos: 1 },
        ),
        COMMAND_PUBLISH_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Could not publish command ${command.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }

    // Conditional on still being open: the device may already have acked
    // (fast device, or this was a re-publish), a newer command may have
    // superseded it, or the sweep may have expired it meanwhile — none of
    // those must be overwritten back to `sent`.
    await this.commandsRepository.update(
      { id: command.id, status: In([...OPEN_COMMAND_STATUSES]) },
      {
        status: CommandStatus.SENT,
        sentAt: now,
        attempts: () => 'attempts + 1',
      },
    );
    return true;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no PUBACK within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
