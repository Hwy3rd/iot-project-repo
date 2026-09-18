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
import { CreateWorkShiftDto } from './dto/create-work-shift.dto';
import { UpdateWorkShiftDto } from './dto/update-work-shift.dto';
import { WorkShiftResponseDto } from './dto/work-shift-response.dto';
import { WorkShiftsService } from './work-shifts.service';

@Controller('work-shifts')
export class WorkShiftsController {
  constructor(private readonly workShiftsService: WorkShiftsService) {}

  @Serialize(WorkShiftResponseDto)
  @Post()
  create(@Body() createWorkShiftDto: CreateWorkShiftDto) {
    return this.workShiftsService.create(createWorkShiftDto);
  }

  @Serialize(WorkShiftResponseDto)
  @Get()
  findAll() {
    return this.workShiftsService.findAll();
  }

  @Serialize(WorkShiftResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workShiftsService.findOne(id);
  }

  @Serialize(WorkShiftResponseDto)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWorkShiftDto: UpdateWorkShiftDto,
  ) {
    return this.workShiftsService.update(id, updateWorkShiftDto);
  }

  @Serialize(WorkShiftResponseDto)
  @Post(':id/check-in')
  checkIn(@Param('id') id: string) {
    return this.workShiftsService.checkIn(id);
  }

  @Serialize(WorkShiftResponseDto)
  @Post(':id/check-out')
  checkOut(@Param('id') id: string) {
    return this.workShiftsService.checkOut(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workShiftsService.remove(id);
  }
}
