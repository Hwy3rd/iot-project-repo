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
import { CreateShiftDto } from './dto/create-shift.dto';
import { ShiftResponseDto } from './dto/shift-response.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { ShiftsService } from './shifts.service';

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Serialize(ShiftResponseDto)
  @Post()
  create(@Body() createShiftDto: CreateShiftDto) {
    return this.shiftsService.create(createShiftDto);
  }

  @Serialize(ShiftResponseDto)
  @Get()
  findAll() {
    return this.shiftsService.findAll();
  }

  @Serialize(ShiftResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shiftsService.findOne(id);
  }

  @Serialize(ShiftResponseDto)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateShiftDto: UpdateShiftDto) {
    return this.shiftsService.update(id, updateShiftDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(id);
  }
}
