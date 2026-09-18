import { IsIn } from 'class-validator';
import { CommandStatus } from '../../../libs/constants/command.constant';

export class AcknowledgeCommandDto {
  @IsIn([CommandStatus.DONE, CommandStatus.FAILED])
  status!: CommandStatus.DONE | CommandStatus.FAILED;
}
