import { IsString, MinLength } from 'class-validator';

// POST /users/:id/password — Admin sets a new password for another account.
export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  newPassword!: string;
}
