import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  DateParam,
  IdParam,
  SearchParam,
} from '../../../common/query/query-params.decorator';

export class QueryColdRoomDto extends PaginationQueryDto {
  // Matches name.
  @SearchParam()
  search?: string;

  @IdParam()
  warehouseId?: string;

  // YYYY-MM-DD, both ends inclusive (UTC days).
  @DateParam()
  createdFrom?: string;

  @DateParam()
  createdTo?: string;
}
