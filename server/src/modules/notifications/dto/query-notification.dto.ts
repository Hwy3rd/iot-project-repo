import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class QueryNotificationDto {
  // Required, not a filter: this list is inherently scoped to one recipient.
  @IsString()
  @MinLength(1)
  userId!: string;

  // A plain string rather than @IsBoolean() + @Type(() => Boolean): the
  // latter turns the query string "false" into `true` (any non-empty string
  // is truthy), which is the opposite of what it should do.
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: string;
}
