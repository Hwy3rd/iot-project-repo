import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createMqttConnection } from './mqtt-options';

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('MQTT connection configuration', () => {
  const caFile = resolve(__dirname, '../../../../certs/mqtt/emqxsl-ca.crt');

  it('keeps LAN connections available without a certificate', () => {
    const connection = createMqttConnection(config());
    expect(connection.url).toBe('mqtt://localhost:1883');
    expect(connection.options.ca).toBeUndefined();
    expect(connection.options.clientId).toBe('iot-backend-app');
    expect(connection.options.clean).toBe(false);
  });

  it('uses a stable identity across restarts and a separate publisher identity', () => {
    const previous = process.env.MQTT_CLIENT_ROLE;
    try {
      const app = createMqttConnection(
        config({ MQTT_CLIENT_ID: 'warehouse-server' }),
      );
      expect(
        createMqttConnection(config({ MQTT_CLIENT_ID: 'warehouse-server' }))
          .options.clientId,
      ).toBe(app.options.clientId);
      process.env.MQTT_CLIENT_ROLE = 'worker';
      expect(
        createMqttConnection(config({ MQTT_CLIENT_ID: 'warehouse-server' }))
          .options.clientId,
      ).toBe('warehouse-server-worker');
    } finally {
      if (previous === undefined) delete process.env.MQTT_CLIENT_ROLE;
      else process.env.MQTT_CLIENT_ROLE = previous;
    }
  });

  it('verifies the broker certificate for cloud connections', () => {
    const connection = createMqttConnection(
      config({ MQTT_URL: 'mqtts://broker.example:8883', MQTT_CA_FILE: caFile }),
    );
    expect(connection.options.rejectUnauthorized).toBe(true);
    expect(connection.options.ca).toBeInstanceOf(Buffer);
  });

  it('uses system trust roots when no custom CA is supplied', () => {
    const connection = createMqttConnection(
      config({ MQTT_URL: 'mqtts://broker.example:8883' }),
    );
    expect(connection.options.rejectUnauthorized).toBe(true);
    expect(connection.options.ca).toBeUndefined();
  });

  it('rejects a certificate configured on an unencrypted connection', () => {
    expect(() =>
      createMqttConnection(
        config({
          MQTT_URL: 'mqtt://broker.example:1883',
          MQTT_CA_FILE: caFile,
        }),
      ),
    ).toThrow('requires a TLS connection');
  });

  it('fails on a missing CA instead of silently disabling verification', () => {
    expect(() =>
      createMqttConnection(
        config({
          MQTT_URL: 'mqtts://broker.example:8883',
          MQTT_CA_FILE: join(tmpdir(), 'iot-missing-mqtt-ca', 'missing.crt'),
        }),
      ),
    ).toThrow();
  });

  it('fails on a malformed CA instead of silently disabling verification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iot-mqtt-ca-'));
    const cleanup = resolve(dir);
    if (!cleanup.startsWith(resolve(tmpdir()) + sep + 'iot-mqtt-ca-')) {
      throw new Error('Unexpected temporary certificate directory');
    }
    try {
      const file = join(dir, 'invalid.crt');
      writeFileSync(file, 'not a certificate');
      expect(() =>
        createMqttConnection(
          config({
            MQTT_URL: 'mqtts://broker.example:8883',
            MQTT_CA_FILE: file,
          }),
        ),
      ).toThrow();
    } finally {
      rmSync(cleanup, { recursive: true });
    }
  });

  it('removes URL credentials from the endpoint used in logs', () => {
    const connection = createMqttConnection(
      config({ MQTT_URL: 'mqtts://user:secret@broker.example:8883' }),
    );
    expect(connection.endpoint).toBe('mqtts://broker.example:8883');
  });

  it('rejects unsupported transports before creating a connection', () => {
    expect(() =>
      createMqttConnection(config({ MQTT_URL: 'https://broker.example' })),
    ).toThrow('MQTT_URL must use');
  });
});
