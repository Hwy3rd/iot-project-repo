import { IsString, MinLength } from 'class-validator';

// POST /users/me/password — the caller changes their own password.
export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}
