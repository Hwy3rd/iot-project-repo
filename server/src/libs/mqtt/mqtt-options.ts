import { ConfigService } from '@nestjs/config';
import { randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IClientOptions } from 'mqtt';

export function createMqttConnection(config: ConfigService): {
  url: string;
  endpoint: string;
  options: IClientOptions;
} {
  const url = config.get<string>('MQTT_URL')?.trim() || 'mqtt://localhost:1883';
  const parsed = new URL(url);
  if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    throw new Error('MQTT_URL must use mqtt, mqtts, ws or wss');
  }
  const secure = ['mqtts:', 'wss:'].includes(parsed.protocol);
  const caFile = config.get<string>('MQTT_CA_FILE')?.trim();
  if (caFile && !secure) {
    throw new Error('MQTT_CA_FILE requires a TLS connection (mqtts or wss)');
  }
  const options: IClientOptions = {
    clientId: `iot-app-${randomUUID()}`,
    username: config.get<string>('MQTT_USERNAME') || undefined,
    password: config.get<string>('MQTT_PASSWORD') || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
    clean: true,
  };
  if (secure) {
    options.rejectUnauthorized = true;
    if (caFile) {
      const ca = readFileSync(caFile);
      if (!new X509Certificate(ca).ca) {
        throw new Error('MQTT_CA_FILE must contain a CA certificate');
      }
      options.ca = ca;
    }
  }
  return {
    url,
    // URL credentials must never be written to connection logs.
    endpoint: `${parsed.protocol}//${parsed.host}`,
    options,
  };
}
