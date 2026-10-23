import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  Provider,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';
import { MQTT_CLIENT } from './mqtt.constant';
import { createMqttConnection } from './mqtt-options';

// One shared connection for the whole `app` process — both the ingest
// subscriber (mqtt-ingest module) and, later, an outbound command publisher
// use this same client rather than opening their own sockets to the broker.
const mqttClientProvider: Provider = {
  provide: MQTT_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const logger = new Logger('MqttModule');
    const { url, endpoint, options } = createMqttConnection(config);
    const client = mqtt.connect(url, options);
    client.on('connect', () =>
      logger.log(`Connected to MQTT broker ${endpoint}`),
    );
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
