import { IsString, MinLength } from 'class-validator';

export class MarkReadDto {
  // Required (unlike AcknowledgeAlertDto.userId): needed to check ownership
  // before marking as read, not just to attribute the action.
  @IsString()
  @MinLength(1)
  userId!: string;
}
