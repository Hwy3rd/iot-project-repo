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
  // No `userId`: a subscription always belongs to the authenticated caller
  // (NotificationsController passes req.user.id). Accepting it from the
  // body would let anyone register their browser for another user's
  // alert pushes.
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
