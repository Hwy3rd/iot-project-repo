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
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { ColdRoomResponseDto } from './dto/cold-room-response.dto';
import { CreateColdRoomDto } from './dto/create-cold-room.dto';
import { UpdateColdRoomDto } from './dto/update-cold-room.dto';
import { ColdRoomsService } from './cold-rooms.service';

@Controller('cold-rooms')
export class ColdRoomsController {
  constructor(private readonly coldRoomsService: ColdRoomsService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WAREHOUSE_BODY, {
    paramName: 'warehouseId',
  })
  @Serialize(ColdRoomResponseDto)
  @Post()
  create(@Body() createColdRoomDto: CreateColdRoomDto) {
    return this.coldRoomsService.create(createColdRoomDto);
  }

  // No warehouse scope on the list endpoint: the service does not yet
  // filter results by the caller's assigned warehouses (see docs/rbac.md).
  @Serialize(ColdRoomResponseDto)
  @Get()
  findAll() {
    return this.coldRoomsService.findAll();
  }

  @WarehouseScope(WarehouseScopeSource.COLD_ROOM_PARAM)
  @Serialize(ColdRoomResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.coldRoomsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.COLD_ROOM_PARAM)
  @Serialize(ColdRoomResponseDto)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateColdRoomDto: UpdateColdRoomDto,
  ) {
    return this.coldRoomsService.update(id, updateColdRoomDto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coldRoomsService.remove(id);
  }
}
