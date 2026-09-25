import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const SEARCH_MAX_LENGTH = 100;

// Free-text `?search=`, trimmed; an all-blank value becomes "" and is ignored.
export const SearchParam = () =>
  applyDecorators(
    IsOptional(),
    IsString(),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    MaxLength(SEARCH_MAX_LENGTH),
  );

// A calendar day, YYYY-MM-DD. IsISO8601 strict rejects impossible dates
// (2026-02-30); the pattern rejects the datetime forms it would also accept.
export const DateParam = () =>
  applyDecorators(
    IsOptional(),
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: '$property must be a date (YYYY-MM-DD)',
    }),
    IsISO8601({ strict: true }),
  );

// A plain string rather than @IsBoolean() + @Type(() => Boolean): the latter
// turns the query string "false" into `true` (any non-empty string is truthy).
export const BooleanStringParam = () =>
  applyDecorators(IsOptional(), IsIn(['true', 'false']));

export const IdParam = () =>
  applyDecorators(IsOptional(), IsString(), MaxLength(36));
