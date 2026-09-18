import { Expose } from 'class-transformer';

export class WarehouseResponseDto {
  @Expose()
  id!: string;

  @Expose()
  name!: string;

  @Expose()
  code!: string;

  @Expose()
  address!: string | null;

  @Expose()
  imageUrls!: string[] | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
