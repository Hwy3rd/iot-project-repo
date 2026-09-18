import { Expose } from 'class-transformer';
import {
  CommandAction,
  CommandStatus,
} from '../../../libs/constants/command.constant';

export class CommandResponseDto {
  @Expose()
  id!: string;

  @Expose()
  channelId!: string;

  @Expose()
  issuedBy!: string | null;

  @Expose()
  action!: CommandAction;

  @Expose()
  payload!: Record<string, unknown> | null;

  @Expose()
  status!: CommandStatus;

  @Expose()
  createdAt!: Date;

  @Expose()
  ackAt!: Date | null;
}
