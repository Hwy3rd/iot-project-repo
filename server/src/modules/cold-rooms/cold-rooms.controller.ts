import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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
import { QueryColdRoomDto } from './dto/query-cold-room.dto';
import { ColdRoomStatusService } from './cold-room-status.service';
import { ColdRoomsService } from './cold-rooms.service';
import { QueryColdRoomStatusDto } from './dto/query-cold-room-status.dto';
import { QueryColdRoomTelemetryDto } from './dto/query-cold-room-telemetry.dto';
import { BulkDeleteDto } from '../../common/bulk/bulk-delete';

@Controller('cold-rooms')
export class ColdRoomsController {
  constructor(
    private readonly coldRoomsService: ColdRoomsService,
    private readonly coldRoomStatusService: ColdRoomStatusService,
  ) {}

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
    @Query() query: QueryColdRoomDto,
  ) {
    return this.coldRoomsService.findAll(access, query);
  }

  // Live overview for the grid views. Declared before GET :id so "status"
  // isn't taken for an id. Anyone assigned to the warehouse may watch it —
  // Staff included, on shift or not (same audience as the realtime
  // `warehouse:{id}` room that pushes updates to these grids); rooms
  // outside the caller's scope are silently left out.
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN, UserRole.STAFF)
  @WarehouseListScope()
  @Get('status')
  findStatuses(
    @Query() query: QueryColdRoomStatusDto,
    @ScopedWarehouses() access: WarehouseAccess,
  ) {
    return this.coldRoomStatusService.findStatuses(query, access);
  }

  // Chart data for the monitoring screen. Same audience as GET status —
  // anyone assigned to the room's warehouse, Staff on shift or not — which
  // is why it's served here, room-level, rather than via the per-device
  // telemetry routes (Staff: raw not allowed, hourly shift-only).
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN, UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.COLD_ROOM_PARAM)
  @Get(':id/telemetry')
  findSeries(
    @Param('id') id: string,
    @Query() query: QueryColdRoomTelemetryDto,
  ) {
    return this.coldRoomStatusService.findSeries(id, query.range);
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

  @Roles(UserRole.ADMIN)
  @Audit({
    action: 'cold_room.delete',
    targetType: 'cold_room',
    entity: ColdRoom,
    bulk: true,
  })
  @HttpCode(HttpStatus.OK)
  @Post('bulk-delete')
  bulkRemove(@Body() dto: BulkDeleteDto) {
    return this.coldRoomsService.bulkRemove(dto.ids);
  }
}
