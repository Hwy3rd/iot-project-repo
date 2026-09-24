import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator';
import { ColdRoom } from './entities/cold-room.entity';
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
  @Audit({
    action: 'cold_room.create',
    targetType: 'cold_room',
    entity: ColdRoom,
  })
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
  @Audit({
    action: 'cold_room.update',
    targetType: 'cold_room',
    entity: ColdRoom,
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateColdRoomDto: UpdateColdRoomDto,
  ) {
    return this.coldRoomsService.update(id, updateColdRoomDto);
  }

  @Roles(UserRole.ADMIN)
  @Audit({
    action: 'cold_room.delete',
    targetType: 'cold_room',
    entity: ColdRoom,
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coldRoomsService.remove(id);
  }
}
