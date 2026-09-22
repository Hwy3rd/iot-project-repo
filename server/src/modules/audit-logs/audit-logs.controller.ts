import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

// Deliberately no PATCH/DELETE routes — audit logs are append-only.
// Admin-only across the board — the one role that gets to see (or write)
// the system audit trail (see docs/rbac.md).
@Controller('audit-logs')
@Roles(UserRole.ADMIN)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Serialize(AuditLogResponseDto)
  @Post()
  create(@Body() createAuditLogDto: CreateAuditLogDto) {
    return this.auditLogsService.create(createAuditLogDto);
  }

  @Serialize(AuditLogResponseDto)
  @Get()
  findAll(@Query() queryAuditLogDto: QueryAuditLogDto) {
    return this.auditLogsService.findAll(queryAuditLogDto);
  }

  @Serialize(AuditLogResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auditLogsService.findOne(id);
  }
}
