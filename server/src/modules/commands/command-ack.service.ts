import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MqttClient } from 'mqtt';
import { In, Repository } from 'typeorm';
import {
  CommandStatus,
  OPEN_COMMAND_STATUSES,
} from '../../libs/constants/command.constant';
import {
  deviceTopicFilter,
  parseDeviceTopic,
} from '../../libs/mqtt/device-topics';
import { MQTT_CLIENT } from '../../libs/mqtt/mqtt.constant';
import { CommandAckMessageDto } from './dto/command-ack-message.dto';
import { Command } from './entities/command.entity';

const ACK_TOPIC_FILTER = deviceTopicFilter('ack');

// Closes the loop opened by CommandDispatcherService: the device reports
// whether it ran a command on devices/{uniqueId}/ack. Runs in `app` only
// (one subscriber is enough), on the same shared client as MqttIngestService
// — each handler skips the other's topics.
@Injectable()
export class CommandAckService implements OnModuleInit {
  private readonly logger = new Logger(CommandAckService.name);

  constructor(
    @Inject(MQTT_CLIENT) private readonly mqttClient: MqttClient,
    @InjectRepository(Command)
    private readonly commandsRepository: Repository<Command>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.mqttClient.on('message', (topic, payload) => {
      void this.handleMessage(topic, payload).catch((error: unknown) =>
        this.logger.error(
          `Unhandled error processing ack on topic ${topic}`,
          error instanceof Error ? error.stack : error,
        ),
      );
    });
    await this.mqttClient.subscribeAsync(ACK_TOPIC_FILTER, { qos: 1 });
    this.logger.log(`Subscribed to ${ACK_TOPIC_FILTER}`);
  }

  // Public so tests can call it without the mqtt client's event plumbing.
  async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const uniqueId = parseDeviceTopic(topic, 'ack');
    if (!uniqueId) return;

    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn(`Ignoring non-JSON ack on ${topic}`);
      return;
    }
    const ack = plainToInstance(CommandAckMessageDto, raw);
    if (validateSync(ack).length > 0) {
      this.logger.warn(`Ignoring invalid ack from device ${uniqueId}`);
      return;
    }

    const command = await this.commandsRepository.findOne({
      where: { id: ack.id },
      relations: { channel: { device: true } },
    });
    // All devices share one broker account, so the topic is the only proof
    // of who is acking: a device may only close its own commands.
    if (command?.channel?.device?.uniqueId !== uniqueId) {
      this.logger.warn(
        `Ignoring ack for command ${ack.id} from device ${uniqueId}: not its command`,
      );
      return;
    }

    // Conditional, so a late ack (command already expired or superseded)
    // or a duplicate one (QoS 1 redelivery, or the device re-acking a
    // re-publish) never rewrites a final state.
    const result = await this.commandsRepository.update(
      { id: command.id, status: In([...OPEN_COMMAND_STATUSES]) },
      {
        status: ack.status,
        ackAt: new Date(),
        errorReason:
          ack.status === CommandStatus.FAILED ? (ack.error ?? 'unknown') : null,
      },
    );
    if (!result.affected) {
      // command.status was read before the update and may be stale: a
      // duplicate ack (QoS 1 redelivery + a re-publish) racing this one can
      // have closed the command in between.
      this.logger.debug(
        `Ack ${ack.status} for command ${command.id} ignored: command already closed (late or duplicate ack)`,
      );
    }
  }
}
