import { Expose } from 'class-transformer';
import { ProductUnit } from '../../../libs/constants/product-unit.constant';

export class ProductTypeResponseDto {
  @Expose()
  id!: string;

  @Expose()
  name!: string;

  @Expose()
  category!: string | null;

  @Expose()
  unit!: ProductUnit;

  @Expose()
  storageTempMin!: number | null;

  @Expose()
  storageTempMax!: number | null;

  @Expose()
  imageUrls!: string[] | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
