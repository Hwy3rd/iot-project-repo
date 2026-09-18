import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { ColdRoomResponseDto } from './dto/cold-room-response.dto';
import { CreateColdRoomDto } from './dto/create-cold-room.dto';
import { UpdateColdRoomDto } from './dto/update-cold-room.dto';
import { ColdRoomsService } from './cold-rooms.service';

@Controller('cold-rooms')
export class ColdRoomsController {
  constructor(private readonly coldRoomsService: ColdRoomsService) {}

  @Serialize(ColdRoomResponseDto)
  @Post()
  create(@Body() createColdRoomDto: CreateColdRoomDto) {
    return this.coldRoomsService.create(createColdRoomDto);
  }

  @Serialize(ColdRoomResponseDto)
  @Get()
  findAll() {
    return this.coldRoomsService.findAll();
  }

  @Serialize(ColdRoomResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.coldRoomsService.findOne(id);
  }

  @Serialize(ColdRoomResponseDto)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateColdRoomDto: UpdateColdRoomDto,
  ) {
    return this.coldRoomsService.update(id, updateColdRoomDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coldRoomsService.remove(id);
  }
}
