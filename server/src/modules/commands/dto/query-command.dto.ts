import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  DateParam,
  IdParam,
} from '../../../common/query/query-params.decorator';
import {
  CommandAction,
  CommandStatus,
} from '../../../libs/constants/command.constant';

export class QueryCommandDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CommandStatus)
  status?: CommandStatus;

  @IsOptional()
  @IsEnum(CommandAction)
  action?: CommandAction;

  @IdParam()
  warehouseId?: string;

  @IdParam()
  deviceId?: string;

  @IdParam()
  channelId?: string;

  @IdParam()
  issuedBy?: string;

  // YYYY-MM-DD, both ends inclusive (UTC days).
  @DateParam()
  createdFrom?: string;

  @DateParam()
  createdTo?: string;
}
