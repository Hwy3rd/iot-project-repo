import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  DateParam,
  IdParam,
} from '../../../common/query/query-params.decorator';
import { WorkShiftStatus } from '../../../libs/constants/work-shift.constant';

export class QueryWorkShiftDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkShiftStatus)
  status?: WorkShiftStatus;

  @IdParam()
  warehouseId?: string;

  @IdParam()
  shiftId?: string;

  @IdParam()
  staffId?: string;

  // YYYY-MM-DD, both ends inclusive.
  @DateParam()
  workDateFrom?: string;

  @DateParam()
  workDateTo?: string;
}
