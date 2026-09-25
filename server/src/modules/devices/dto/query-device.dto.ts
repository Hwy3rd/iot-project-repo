import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  BooleanStringParam,
  IdParam,
  SearchParam,
} from '../../../common/query/query-params.decorator';
import { DeviceStatus } from '../../../libs/constants/device.constant';

export class QueryDeviceDto extends PaginationQueryDto {
  // Matches unique id or firmware version.
  @SearchParam()
  search?: string;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IdParam()
  warehouseId?: string;

  @IdParam()
  coldRoomId?: string;

  // "true" = not claimed into any cold room (Admin-only rows).
  @BooleanStringParam()
  unassigned?: string;
}
