import { IsString, MinLength } from 'class-validator';

export class UnsubscribeDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;
}
