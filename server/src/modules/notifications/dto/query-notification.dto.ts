import { IsIn, IsOptional } from 'class-validator';

export class QueryNotificationDto {
  // A plain string rather than @IsBoolean() + @Type(() => Boolean): the
  // latter turns the query string "false" into `true` (any non-empty string
  // is truthy), which is the opposite of what it should do.
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: string;
}
