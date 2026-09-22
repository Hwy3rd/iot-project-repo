import { IsString, MinLength } from 'class-validator';

export class JoinWarehouseDto {
  @IsString()
  @MinLength(1)
  warehouseId!: string;
}
