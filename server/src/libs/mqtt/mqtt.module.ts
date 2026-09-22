import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  Provider,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import mqtt, { MqttClient } from 'mqtt';
import { MQTT_CLIENT } from './mqtt.constant';

// One shared connection for the whole `app` process — both the ingest
// subscriber (mqtt-ingest module) and, later, an outbound command publisher
// use this same client rather than opening their own sockets to the broker.
const mqttClientProvider: Provider = {
  provide: MQTT_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const logger = new Logger('MqttModule');
    const url = config.get<string>('MQTT_URL') ?? 'mqtt://localhost:1883';
    const client = mqtt.connect(url, {
      // Random per-process id: the app has no need for a persistent MQTT
      // session across restarts (`clean: true`, the default), and a fixed
      // id would make the broker disconnect a still-running instance the
      // moment a second one (re)connects with the same id.
      clientId: `iot-app-${randomUUID()}`,
      username: config.get<string>('MQTT_USERNAME') || undefined,
      password: config.get<string>('MQTT_PASSWORD') || undefined,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    });
    client.on('connect', () => logger.log(`Connected to MQTT broker ${url}`));
    client.on('reconnect', () => logger.warn('Reconnecting to MQTT broker'));
    client.on('error', (error) => logger.error('MQTT client error', error));
    return client;
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [mqttClientProvider],
  exports: [MQTT_CLIENT],
})
export class MqttModule implements OnModuleDestroy {
  constructor(@Inject(MQTT_CLIENT) private readonly client: MqttClient) {}

  onModuleDestroy() {
    return this.client.endAsync();
  }
}
