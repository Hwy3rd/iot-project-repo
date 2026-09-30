import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from '../../../libs/constants/auth.constant';
import { UserRole } from '../../../libs/constants/user.constant';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(USERNAME_MAX_LENGTH)
  username!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];
}
