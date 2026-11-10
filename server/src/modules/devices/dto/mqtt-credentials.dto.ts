import { Expose } from 'class-transformer';

// What the board's config.h needs: MQTT_USERNAME, MQTT_PASSWORD, DEVICE_ID.
export class MqttCredentialsDto {
  @Expose()
  username!: string;

  @Expose()
  password!: string;

  @Expose()
  clientId!: string;
}
