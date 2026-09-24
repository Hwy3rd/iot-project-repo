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

  // No `issuedBy` here on purpose: the issuer is always the authenticated
  // caller (CommandsController passes req.user.id), never client-supplied —
  // command history is kept forever to trace responsibility (REQUIREMENT
  // §3.8), so it must not be spoofable.
}
