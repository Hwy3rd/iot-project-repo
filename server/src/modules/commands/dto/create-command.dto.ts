import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CommandAction } from '../../../libs/constants/command.constant';

export class CreateCommandDto {
  @IsString()
  @MinLength(1)
  channelId!: string;

  @IsEnum(CommandAction)
  action!: CommandAction;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  // Omit when the command is issued by an automated rule rather than a user.
  @IsOptional()
  @IsString()
  @MinLength(1)
  issuedBy?: string;
}
