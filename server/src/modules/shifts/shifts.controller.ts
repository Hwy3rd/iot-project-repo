import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { CreateShiftDto } from './dto/create-shift.dto';
import { ShiftResponseDto } from './dto/shift-response.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { ShiftsService } from './shifts.service';

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Roles(UserRole.ADMIN)
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

  @Roles(UserRole.ADMIN)
  @Serialize(ShiftResponseDto)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateShiftDto: UpdateShiftDto) {
    return this.shiftsService.update(id, updateShiftDto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(id);
  }
}
