import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import { ProductUnit } from '../../../libs/constants/product-unit.constant';

export class CreateProductTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsEnum(ProductUnit)
  unit!: ProductUnit;

  @IsOptional()
  @IsNumber()
  storageTempMin?: number;

  @IsOptional()
  @IsNumber()
  storageTempMax?: number;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];
}
