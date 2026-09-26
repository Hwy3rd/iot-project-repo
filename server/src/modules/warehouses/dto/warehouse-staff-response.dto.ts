import { Expose, Type } from 'class-transformer';
import { UserRole } from '../../../libs/constants/user.constant';

class WarehouseStaffUserDto {
  @Expose()
  id!: string;

  @Expose()
  username!: string;

  @Expose()
  fullName!: string | null;

  // What they may do in this warehouse — the same in all of theirs.
  @Expose()
  role!: UserRole;
}

export class WarehouseStaffResponseDto {
  @Expose()
  userId!: string;

  @Expose()
  warehouseId!: string;

  @Expose()
  createdAt!: Date;

  @Expose()
  @Type(() => WarehouseStaffUserDto)
  user?: WarehouseStaffUserDto;
}
