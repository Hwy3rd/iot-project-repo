import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import {
  ScopedWarehouses,
  WarehouseListScope,
} from '../../common/decorators/warehouse-list-scope.decorator';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { CommandsService } from './commands.service';
import { AcknowledgeCommandDto } from './dto/acknowledge-command.dto';
import { CommandResponseDto } from './dto/command-response.dto';
import { CreateCommandDto } from './dto/create-command.dto';

const VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.TECHNICIAN,
  UserRole.STAFF,
];

// Deliberately no DELETE route — commands are permanent history, same as
// alerts/audit-logs/device-status-history (see Command entity's header
// comment: history must survive the issuing user/channel being removed).
@Controller('commands')
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  // Manager gets read-only visibility (see docs/rbac.md); issuing a
  // command is Technician's "điều khiển chủ động" or Staff's limited
  // "điều khiển cơ bản" (requires an active shift).
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN, UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.CHANNEL_BODY, {
    paramName: 'channelId',
    requireShift: true,
  })
  @Serialize(CommandResponseDto)
  @Post()
  create(
    @Body() createCommandDto: CreateCommandDto,
    @GetUserId() userId: string,
  ) {
    return this.commandsService.create(createCommandDto, userId);
  }

  @Roles(...VIEW_ROLES)
  @Serialize(CommandResponseDto)
  @WarehouseListScope()
  @Get()
  findAll(
    @ScopedWarehouses() access: WarehouseAccess,
    @Query() query: PaginationQueryDto,
  ) {
    return this.commandsService.findAll(access, query);
  }

  @Roles(...VIEW_ROLES)
  @WarehouseScope(WarehouseScopeSource.COMMAND_PARAM)
  @Serialize(CommandResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.commandsService.findOne(id);
  }

  // Called by the device/broker bridge to report delivery/execution, not by
  // an end user — no service-account mechanism exists yet, so restricted to
  // Admin until one is added (see docs/rbac.md).
  @Roles(UserRole.ADMIN)
  @Serialize(CommandResponseDto)
  @Post(':id/sent')
  markSent(@Param('id') id: string) {
    return this.commandsService.markSent(id);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(CommandResponseDto)
  @Post(':id/ack')
  acknowledge(
    @Param('id') id: string,
    @Body() acknowledgeCommandDto: AcknowledgeCommandDto,
  ) {
    return this.commandsService.acknowledge(id, acknowledgeCommandDto);
  }
}
