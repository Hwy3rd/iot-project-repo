import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  DateParam,
  SearchParam,
} from '../../../common/query/query-params.decorator';

export class QueryNotificationDto extends PaginationQueryDto {
  // A plain string rather than @IsBoolean() + @Type(() => Boolean): the
  // latter turns the query string "false" into `true` (any non-empty string
  // is truthy), which is the opposite of what it should do.
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: string;

  // Matches title or body.
  @SearchParam()
  search?: string;

  // YYYY-MM-DD, both ends inclusive (UTC days).
  @DateParam()
  createdFrom?: string;

  @DateParam()
  createdTo?: string;
}
