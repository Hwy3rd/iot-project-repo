import { Expose } from 'class-transformer';
import { UserRole, UserStatus } from '../../../libs/constants/user.constant';

export class UserResponseDto {
  @Expose()
  id!: string;

  @Expose()
  username!: string;

  @Expose()
  email!: string | null;

  @Expose()
  phone!: string | null;

  @Expose()
  fullName!: string | null;

  @Expose()
  imageUrls!: string[] | null;

  @Expose()
  role!: UserRole;

  @Expose()
  status!: UserStatus;

  @Expose()
  lastLoginAt!: Date | null;

  // End of a temporary block from too many failed logins, if one is active
  // (UsersService.withLoginBlock). Only on GET /users, GET /users/:id and
  // POST /users/:id/unlock.
  @Expose()
  loginBlockedUntil?: Date | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
