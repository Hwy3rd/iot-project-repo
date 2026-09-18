import { IsString, MinLength } from 'class-validator';

export class ClaimDeviceDto {
  @IsString()
  @MinLength(1)
  claimCode!: string;

  @IsString()
  @MinLength(1)
  coldRoomId!: string;
}
