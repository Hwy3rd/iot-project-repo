import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Matches the shape of the browser's `PushSubscription.toJSON()` exactly,
// so the frontend can POST it unmodified.
class PushSubscriptionKeysDto {
  @IsString()
  @MinLength(1)
  p256dh!: string;

  @IsString()
  @MinLength(1)
  auth!: string;
}

export class CreatePushSubscriptionDto {
  // No auth wired on this controller (same gap as every other module in
  // this repo — see server/CLAUDE.md) — the caller states who it's for,
  // same convention as CreateCommandDto.issuedBy.
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsString()
  @MinLength(1)
  endpoint!: string;

  // @ValidateNested() alone does not reject a missing `keys` — it only
  // validates the nested object's own fields once one exists. @IsObject()
  // is what actually makes this field required.
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;

  @IsOptional()
  @IsString()
  userAgent?: string;
}
