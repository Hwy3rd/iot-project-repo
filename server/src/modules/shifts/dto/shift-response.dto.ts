import { Expose } from 'class-transformer';

export class ShiftResponseDto {
  @Expose()
  id!: string;

  @Expose()
  name!: string;

  @Expose()
  startTime!: string;

  @Expose()
  endTime!: string;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
