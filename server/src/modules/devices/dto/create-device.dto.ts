import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MQTT_IDENTIFIER } from '../device-mqtt-account.service';

export class CreateDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  // Firmware uses it as MQTT client id, username and topic segment.
  @Matches(MQTT_IDENTIFIER, {
    message: 'uniqueId may only contain letters, digits, ".", "_" and "-"',
  })
  uniqueId!: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;
}
