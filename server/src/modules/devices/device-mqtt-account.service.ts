import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MqttClient } from 'mqtt';
import { randomBytes, randomUUID } from 'crypto';
import { deviceTopic } from '../../libs/mqtt/device-topics';
import { MQTT_CLIENT } from '../../libs/mqtt/mqtt.constant';
import { withTimeout } from '../../libs/mqtt/with-timeout';

// Mosquitto's Dynamic Security plugin (mosquitto/mosquitto.conf): accounts
// are added/removed at runtime by publishing JSON commands here, no broker
// restart. Only the backend account may use these topics (mosquitto ACL).
export const DYNSEC_TOPIC = '$CONTROL/dynamic-security/v1';
export const DYNSEC_RESPONSE_TOPIC = `${DYNSEC_TOPIC}/response`;
const RESPONSE_TIMEOUT_MS = 5000;

// Same rule as the firmware's DEVICE_ID: it becomes an MQTT username,
// client id and topic segment, where '/', '+' or '#' would widen the ACL.
export const MQTT_IDENTIFIER = /^[A-Za-z0-9_.-]+$/;

export interface MqttCredentials {
  username: string;
  password: string;
  clientId: string;
}

interface DynsecCommand {
  command: string;
  correlationData?: string;
  [key: string]: unknown;
}

interface DynsecResponse {
  command: string;
  error?: string;
  correlationData?: string;
}

// Errors that only mean "already in the wanted state" for a delete/disable.
const NOT_FOUND = new Set(['Client not found', 'Role not found']);

export function deviceRoleName(uniqueId: string): string {
  return `device:${uniqueId}`;
}

// Exactly the topics firmware uses (firmware/cold_room_monitor), nothing
// else: send telemetry + command acks; receive commands, its room config
// and telemetry acks. Receive is granted per topic because the plugin's
// default denies it — otherwise a board could read others' commands.
export function deviceRoleAcls(uniqueId: string) {
  const send = ['telemetry', 'ack'] as const;
  const receive = ['commands', 'config', 'telemetry-ack'] as const;
  return [
    ...send.map((kind) => ({
      acltype: 'publishClientSend',
      topic: deviceTopic(uniqueId, kind),
      allow: true,
    })),
    ...receive.flatMap((kind) => [
      {
        acltype: 'subscribeLiteral',
        topic: deviceTopic(uniqueId, kind),
        allow: true,
      },
      {
        acltype: 'publishClientReceive',
        topic: deviceTopic(uniqueId, kind),
        allow: true,
      },
    ]),
  ];
}

// One broker account per device: username = client id = unique_id, so the
// board's config.h only needs the password this hands out once. The broker
// stores only a hash; the password is never kept here or in the DB.
//
// Off unless MQTT_DEVICE_ACCOUNTS=dynsec (local/tunnel Mosquitto). EMQX
// (cloud mode) has no such plugin — accounts are made in its console.
@Injectable()
export class DeviceMqttAccountService implements OnModuleInit {
  private readonly logger = new Logger(DeviceMqttAccountService.name);
  private readonly pending = new Map<
    string,
    (response: DynsecResponse) => void
  >();
  private subscribed?: Promise<unknown>;

  constructor(
    @Inject(MQTT_CLIENT) private readonly mqttClient: MqttClient,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('MQTT_DEVICE_ACCOUNTS') === 'dynsec';
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.mqttClient.on('message', (topic, payload) => {
      if (topic === DYNSEC_RESPONSE_TOPIC) this.handleResponse(payload);
    });
  }

  // Public so tests can feed responses without the mqtt client.
  handleResponse(payload: Buffer) {
    let body: { responses?: DynsecResponse[] };
    try {
      body = JSON.parse(payload.toString('utf8')) as typeof body;
    } catch {
      return;
    }
    for (const response of body.responses ?? []) {
      const resolve = response.correlationData
        ? this.pending.get(response.correlationData)
        : undefined;
      resolve?.(response);
    }
  }

  // Creates the account, or replaces it with a new password (which also
  // drops the board's current connection). Throws when not possible.
  async issue(uniqueId: string): Promise<MqttCredentials> {
    this.assertUsable(uniqueId);
    const rolename = deviceRoleName(uniqueId);
    const password = randomBytes(18).toString('base64url');
    await this.run(
      [
        { command: 'deleteClient', username: uniqueId },
        { command: 'deleteRole', rolename },
        { command: 'createRole', rolename, acls: deviceRoleAcls(uniqueId) },
        {
          command: 'createClient',
          username: uniqueId,
          password,
          clientid: uniqueId,
          roles: [{ rolename }],
        },
      ],
      NOT_FOUND,
    );
    return { username: uniqueId, password, clientId: uniqueId };
  }

  // Decommissioned: the board can no longer connect (kicked if connected).
  disable(uniqueId: string): Promise<void> {
    return this.bestEffort('disable', uniqueId, [
      { command: 'disableClient', username: uniqueId },
    ]);
  }

  // Deleted device: the account and its role go away.
  remove(uniqueId: string): Promise<void> {
    return this.bestEffort('remove', uniqueId, [
      { command: 'deleteClient', username: uniqueId },
      { command: 'deleteRole', rolename: deviceRoleName(uniqueId) },
    ]);
  }

  private assertUsable(uniqueId: string) {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Broker does not manage device accounts (MQTT_DEVICE_ACCOUNTS is not dynsec)',
      );
    }
    if (!MQTT_IDENTIFIER.test(uniqueId)) {
      throw new BadRequestException(
        'unique_id may only contain letters, digits, ".", "_" and "-" to get an MQTT account',
      );
    }
    // A dynsec account wins over the broker's password file for the same
    // username — reusing one of these would lock that account out. (A
    // tunnel devices.txt line is a device's own account: replacing it from
    // the UI is intended.)
    if (this.reservedUsernames().has(uniqueId)) {
      throw new BadRequestException(
        `unique_id ${uniqueId} is a reserved MQTT account name`,
      );
    }
  }

  private reservedUsernames(): Set<string> {
    return new Set(
      [
        this.config.get<string>('MQTT_USERNAME'),
        this.config.get<string>('MQTT_DEVICE_USERNAME') || 'device',
      ].filter((name): name is string => !!name),
    );
  }

  // Lifecycle hooks: the HTTP action already succeeded and the account may
  // never have existed (made before this feature, or broker without it).
  private async bestEffort(
    action: string,
    uniqueId: string,
    commands: DynsecCommand[],
  ) {
    if (!this.enabled || !MQTT_IDENTIFIER.test(uniqueId)) return;
    if (this.reservedUsernames().has(uniqueId)) return;
    try {
      await this.run(commands, NOT_FOUND);
    } catch (error) {
      this.logger.warn(
        `Could not ${action} MQTT account ${uniqueId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async run(commands: DynsecCommand[], ignore: Set<string>) {
    this.subscribed ??= this.mqttClient
      .subscribeAsync(DYNSEC_RESPONSE_TOPIC, { qos: 1 })
      .catch((error: unknown) => {
        this.subscribed = undefined;
        throw error;
      });
    try {
      await withTimeout(this.subscribed, RESPONSE_TIMEOUT_MS);
    } catch {
      throw new ServiceUnavailableException('MQTT broker is unreachable');
    }

    const tagged = commands.map((c) => ({
      ...c,
      correlationData: randomUUID(),
    }));
    const responses = tagged.map(
      (c) =>
        new Promise<DynsecResponse>((resolve) =>
          this.pending.set(c.correlationData, resolve),
        ),
    );
    try {
      await withTimeout(
        this.mqttClient.publishAsync(
          DYNSEC_TOPIC,
          JSON.stringify({ commands: tagged }),
          { qos: 1 },
        ),
        RESPONSE_TIMEOUT_MS,
      );
      const results = await withTimeout(
        Promise.all(responses),
        RESPONSE_TIMEOUT_MS,
      );
      const failed = results.find((r) => r.error && !ignore.has(r.error));
      if (failed) {
        throw new ServiceUnavailableException(
          `MQTT broker rejected ${failed.command}: ${failed.error}`,
        );
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'MQTT broker did not answer (is the dynamic-security plugin loaded?)',
      );
    } finally {
      for (const c of tagged) this.pending.delete(c.correlationData);
    }
  }
}
