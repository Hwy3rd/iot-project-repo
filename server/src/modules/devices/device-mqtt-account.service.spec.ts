import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MqttClient } from 'mqtt';
import {
  DYNSEC_RESPONSE_TOPIC,
  DYNSEC_TOPIC,
  DeviceMqttAccountService,
  deviceRoleAcls,
} from './device-mqtt-account.service';

interface SentCommand {
  command: string;
  correlationData: string;
  [key: string]: unknown;
}

describe('DeviceMqttAccountService', () => {
  let service: DeviceMqttAccountService;
  let client: {
    on: jest.Mock;
    subscribeAsync: jest.Mock;
    publishAsync: jest.Mock;
  };
  let env: Record<string, string | undefined>;
  // What the broker answers per command name (absent = success).
  let errors: Record<string, string>;
  let sent: SentCommand[];

  beforeEach(() => {
    env = { MQTT_DEVICE_ACCOUNTS: 'dynsec', MQTT_USERNAME: 'server' };
    errors = {};
    sent = [];
    client = {
      on: jest.fn(),
      subscribeAsync: jest.fn().mockResolvedValue([]),
      // Answers like the plugin: one response per command, same order.
      publishAsync: jest.fn((topic: string, body: string) => {
        expect(topic).toBe(DYNSEC_TOPIC);
        const { commands } = JSON.parse(body) as { commands: SentCommand[] };
        sent.push(...commands);
        const responses = commands.map((c) => ({
          command: c.command,
          correlationData: c.correlationData,
          ...(errors[c.command] ? { error: errors[c.command] } : {}),
        }));
        setImmediate(() =>
          service.handleResponse(Buffer.from(JSON.stringify({ responses }))),
        );
        return Promise.resolve(undefined);
      }),
    };
    const config = { get: (key: string) => env[key] } as ConfigService;
    service = new DeviceMqttAccountService(
      client as unknown as MqttClient,
      config,
    );
  });

  it('is off unless the broker is dynsec', () => {
    env.MQTT_DEVICE_ACCOUNTS = undefined;
    expect(service.enabled).toBe(false);
    service.onModuleInit();
    expect(client.on).not.toHaveBeenCalled();
  });

  it('issues a fresh account bound to the device id', async () => {
    // First issue: nothing to delete yet.
    errors = { deleteClient: 'Client not found', deleteRole: 'Role not found' };

    const credentials = await service.issue('esp32-a');

    expect(client.subscribeAsync).toHaveBeenCalledWith(DYNSEC_RESPONSE_TOPIC, {
      qos: 1,
    });
    expect(credentials.username).toBe('esp32-a');
    expect(credentials.clientId).toBe('esp32-a');
    expect(credentials.password.length).toBeGreaterThanOrEqual(24);
    expect(sent.map((c) => c.command)).toEqual([
      'deleteClient',
      'deleteRole',
      'createRole',
      'createClient',
    ]);
    expect(sent[3]).toMatchObject({
      username: 'esp32-a',
      clientid: 'esp32-a',
      password: credentials.password,
      roles: [{ rolename: 'device:esp32-a' }],
    });
  });

  it('gives a new password on every issue', async () => {
    const first = await service.issue('esp32-a');
    const second = await service.issue('esp32-a');
    expect(second.password).not.toBe(first.password);
  });

  it('only grants the device its own topics', () => {
    const acls = deviceRoleAcls('esp32-a');
    expect(acls.every((a) => a.topic.startsWith('devices/esp32-a/'))).toBe(
      true,
    );
    expect(
      acls.filter((a) => a.acltype === 'publishClientSend').map((a) => a.topic),
    ).toEqual(['devices/esp32-a/telemetry', 'devices/esp32-a/ack']);
    expect(
      acls
        .filter((a) => a.acltype === 'publishClientReceive')
        .map((a) => a.topic),
    ).toEqual([
      'devices/esp32-a/commands',
      'devices/esp32-a/config',
      'devices/esp32-a/telemetry-ack',
    ]);
  });

  it('refuses ids that would widen the ACL or reuse a broker account', async () => {
    await expect(service.issue('esp32/#')).rejects.toThrow(BadRequestException);
    await expect(service.issue('server')).rejects.toThrow(BadRequestException);
    await expect(service.issue('device')).rejects.toThrow(BadRequestException);
    expect(client.publishAsync).not.toHaveBeenCalled();
  });

  it('reports a real broker error', async () => {
    errors = { createClient: 'Client already exists' };
    await expect(service.issue('esp32-a')).rejects.toThrow(
      'rejected createClient: Client already exists',
    );
  });

  it('fails when the broker never answers', async () => {
    jest.useFakeTimers();
    try {
      client.publishAsync.mockResolvedValue(undefined);
      const issued = service.issue('esp32-a');
      const assertion = expect(issued).rejects.toThrow(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(6000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('disables and removes without failing the caller', async () => {
    errors = { disableClient: 'Client not found' };
    await expect(service.disable('esp32-a')).resolves.toBeUndefined();
    client.publishAsync.mockRejectedValue(new Error('offline'));
    await expect(service.remove('esp32-a')).resolves.toBeUndefined();
  });
});
