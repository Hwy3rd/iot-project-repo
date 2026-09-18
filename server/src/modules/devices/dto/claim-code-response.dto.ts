import { Expose } from 'class-transformer';

export class ClaimCodeResponseDto {
  @Expose()
  claimCode!: string;

  @Expose()
  claimCodeExpiresAt!: Date;
}
