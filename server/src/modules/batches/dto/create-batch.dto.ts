import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBatchDto {
  @IsString()
  @MinLength(1)
  coldRoomId!: string;

  @IsString()
  @MinLength(1)
  productTypeId!: string;

  @IsString()
  @MinLength(1)
  batchCode!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsDateString()
  receivedAt!: string;

  @IsDateString()
  expiryDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
