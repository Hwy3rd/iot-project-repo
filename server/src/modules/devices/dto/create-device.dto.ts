import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @MinLength(1)
  uniqueId!: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;
}
