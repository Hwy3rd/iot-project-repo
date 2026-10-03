import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CommandStatus } from '../../../libs/constants/command.constant';

// Shape of the JSON a device publishes to `devices/{uniqueId}/ack` once it
// has run (or refused) a command.
export class CommandAckMessageDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsIn([CommandStatus.DONE, CommandStatus.FAILED])
  status!: CommandStatus.DONE | CommandStatus.FAILED;

  // Device-side reason for a failure, e.g. "unsupported_channel".
  @IsOptional()
  @IsString()
  @MaxLength(255)
  error?: string;
}
