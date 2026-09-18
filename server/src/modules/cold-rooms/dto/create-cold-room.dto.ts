import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateColdRoomDto {
  @IsString()
  @MinLength(1)
  warehouseId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsNumber()
  tempMin!: number;

  @IsNumber()
  tempMax!: number;

  @IsOptional()
  @IsNumber()
  hysteresis?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  doorOpenMaxSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacityPallets?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacityWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacityVolumeM3?: number;
}
