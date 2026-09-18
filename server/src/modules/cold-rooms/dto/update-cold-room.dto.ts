import { PartialType } from '@nestjs/mapped-types';
import { CreateColdRoomDto } from './create-cold-room.dto';

export class UpdateColdRoomDto extends PartialType(CreateColdRoomDto) {}
