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
  sentAt!: Date | null;

  @Expose()
  attempts!: number;

  @Expose()
  expiresAt!: Date;

  @Expose()
  ackAt!: Date | null;

  @Expose()
  errorReason!: string | null;
}
