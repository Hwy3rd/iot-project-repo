import { Controller, Get, Param, Query } from '@nestjs/common';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import { GetUserRole } from '../../common/decorators/get-user-role.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

// Read-only over HTTP: no POST/PATCH/DELETE. Entries are appended only from
// inside the server (other modules call AuditLogsService.create directly),
// so no client — not even an Admin — can forge or alter the trail.
// Reading is Admin (system-wide) or a warehouse's Manager (only entries
// scoped to warehouses they manage — enforced in AuditLogsService.findAll).
// See docs/RBAC.md.
@Controller('audit-logs')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Serialize(AuditLogResponseDto)
  @Get()
  findAll(
    @Query() queryAuditLogDto: QueryAuditLogDto,
    @GetUserId() userId: string,
    @GetUserRole() role: UserRole,
  ) {
    return this.auditLogsService.findAll(queryAuditLogDto, {
      id: userId,
      role,
    });
  }

  @Serialize(AuditLogResponseDto)
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetUserId() userId: string,
    @GetUserRole() role: UserRole,
  ) {
    return this.auditLogsService.findOne(id, { id: userId, role });
  }
}
