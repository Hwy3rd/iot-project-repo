import { IsUrl } from 'class-validator';

export class DeleteImageDto {
  @IsUrl()
  url!: string;
}
