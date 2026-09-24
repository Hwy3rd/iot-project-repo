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
import {
  ScopedWarehouses,
  WarehouseListScope,
} from '../../common/decorators/warehouse-list-scope.decorator';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
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

  @Serialize(ColdRoomResponseDto)
  @WarehouseListScope()
  @Get()
  findAll(
    @ScopedWarehouses() access: WarehouseAccess,
    @Query() query: PaginationQueryDto,
  ) {
    return this.coldRoomsService.findAll(access, query);
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
