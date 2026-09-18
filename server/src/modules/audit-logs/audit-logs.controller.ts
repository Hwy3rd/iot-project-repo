import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

// Deliberately no PATCH/DELETE routes — audit logs are append-only.
@Controller('audit-logs')
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
