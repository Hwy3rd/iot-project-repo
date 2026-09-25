import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { DateParam } from '../../../common/query/query-params.decorator';

export class QueryAuditLogDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  // Exact action name, e.g. "warehouse.update".
  @IsOptional()
  @IsString()
  action?: string;

  // YYYY-MM-DD, both ends inclusive (UTC days).
  @DateParam()
  createdFrom?: string;

  @DateParam()
  createdTo?: string;
}
