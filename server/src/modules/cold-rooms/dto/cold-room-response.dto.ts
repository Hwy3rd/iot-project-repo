import { Expose } from 'class-transformer';

export class ColdRoomResponseDto {
  @Expose()
  id!: string;

  @Expose()
  warehouseId!: string;

  @Expose()
  name!: string;

  @Expose()
  tempMin!: number;

  @Expose()
  tempMax!: number;

  @Expose()
  hysteresis!: number;

  @Expose()
  doorOpenMaxSeconds!: number;

  @Expose()
  capacityPallets!: number | null;

  @Expose()
  capacityWeightKg!: number | null;

  @Expose()
  capacityVolumeM3!: number | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
