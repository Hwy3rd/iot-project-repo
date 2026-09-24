import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryMessageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  // Cursor for loading older history: return messages sent before this
  // message id (from the same conversation). Omit for the latest page.
  @IsOptional()
  @IsString()
  before?: string;
}
