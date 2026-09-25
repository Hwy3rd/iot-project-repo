import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../../libs/constants/pagination.constant';

// `?coldRoomIds=a,b,c` → ['a', 'b', 'c'] (also accepts repeated params).
const commaList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : value;

// Which rooms to report on — the ones a page is showing. At least one of
// the two is required (checked in the service); both are capped like a page.
export class QueryColdRoomStatusDto {
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  coldRoomIds?: string[];

  // Every room of these warehouses, e.g. for a warehouse grid.
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  warehouseIds?: string[];
}
