import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { SearchParam } from '../../../common/query/query-params.decorator';
import { ProductUnit } from '../../../libs/constants/product-unit.constant';

export class QueryProductTypeDto extends PaginationQueryDto {
  // Matches name or category.
  @SearchParam()
  search?: string;

  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;
}
