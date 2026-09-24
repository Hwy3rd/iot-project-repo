import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';
import { Shift } from './entities/shift.entity';
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
  @Audit({ action: 'shift.create', targetType: 'shift', entity: Shift })
  @Post()
  create(@Body() createShiftDto: CreateShiftDto) {
    return this.shiftsService.create(createShiftDto);
  }

  @Serialize(ShiftResponseDto)
  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.shiftsService.findAll(query);
  }

  @Serialize(ShiftResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shiftsService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(ShiftResponseDto)
  @Audit({ action: 'shift.update', targetType: 'shift', entity: Shift })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateShiftDto: UpdateShiftDto) {
    return this.shiftsService.update(id, updateShiftDto);
  }

  @Roles(UserRole.ADMIN)
  @Audit({ action: 'shift.delete', targetType: 'shift', entity: Shift })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(id);
  }
}
