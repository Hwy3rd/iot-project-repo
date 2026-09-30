import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
} from '../../../libs/constants/auth.constant';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(USERNAME_MAX_LENGTH)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
