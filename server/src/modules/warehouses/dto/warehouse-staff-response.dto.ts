import { Expose, Type } from 'class-transformer';
import { UserRole } from '../../../libs/constants/user.constant';

class WarehouseStaffUserDto {
  @Expose()
  id!: string;

  @Expose()
  username!: string;

  @Expose()
  fullName!: string | null;
}

export class WarehouseStaffResponseDto {
  @Expose()
  userId!: string;

  @Expose()
  warehouseId!: string;

  // Role within this warehouse — may differ from the user's global role.
  @Expose()
  role!: UserRole;

  @Expose()
  createdAt!: Date;

  @Expose()
  @Type(() => WarehouseStaffUserDto)
  user?: WarehouseStaffUserDto;
}
