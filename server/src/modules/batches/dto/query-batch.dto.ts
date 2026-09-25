import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  DateParam,
  IdParam,
  SearchParam,
} from '../../../common/query/query-params.decorator';
import { BatchStatus } from '../../../libs/constants/batch.constant';

export class QueryBatchDto extends PaginationQueryDto {
  // Matches batch code or supplier.
  @SearchParam()
  search?: string;

  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;

  @IdParam()
  warehouseId?: string;

  @IdParam()
  coldRoomId?: string;

  @IdParam()
  productTypeId?: string;

  // YYYY-MM-DD, both ends inclusive.
  @DateParam()
  expiryFrom?: string;

  @DateParam()
  expiryTo?: string;

  @DateParam()
  receivedFrom?: string;

  @DateParam()
  receivedTo?: string;
}
