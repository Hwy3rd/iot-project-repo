import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  DateParam,
  IdParam,
} from '../../../common/query/query-params.decorator';
import { AlertStatus, AlertType } from '../../../libs/constants/alert.constant';

export class QueryAlertDto extends PaginationQueryDto {
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

  @IdParam()
  warehouseId?: string;

  // YYYY-MM-DD, both ends inclusive (UTC days).
  @DateParam()
  createdFrom?: string;

  @DateParam()
  createdTo?: string;
}
