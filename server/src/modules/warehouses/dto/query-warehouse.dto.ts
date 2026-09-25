import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import {
  BooleanStringParam,
  DateParam,
  SearchParam,
} from '../../../common/query/query-params.decorator';

export class QueryWarehouseDto extends PaginationQueryDto {
  // Matches name, code or address.
  @SearchParam()
  search?: string;

  @DateParam()
  createdFrom?: string;

  @DateParam()
  createdTo?: string;

  // An empty-string address counts as missing.
  @BooleanStringParam()
  hasAddress?: string;
}
