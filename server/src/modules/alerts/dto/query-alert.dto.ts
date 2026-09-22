import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AlertStatus, AlertType } from '../../../libs/constants/alert.constant';

export class QueryAlertDto {
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @IsOptional()
  @IsString()
  coldRoomId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;
}
