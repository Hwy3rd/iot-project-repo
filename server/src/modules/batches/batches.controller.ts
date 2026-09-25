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
import { Batch } from './entities/batch.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { BatchResponseDto } from './dto/batch-response.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { QueryBatchDto } from './dto/query-batch.dto';
import { BatchesService } from './batches.service';
import { BulkDeleteDto } from '../../common/bulk/bulk-delete';

const BATCH_ROLES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF];

@Controller('batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Roles(...BATCH_ROLES)
  @WarehouseScope(WarehouseScopeSource.COLD_ROOM_BODY, {
    paramName: 'coldRoomId',
    requireShift: true,
  })
  @Serialize(BatchResponseDto)
  @Audit({ action: 'batch.create', targetType: 'batch', entity: Batch })
  @Post()
  create(@Body() createBatchDto: CreateBatchDto) {
    return this.batchesService.create(createBatchDto);
  }

  @Roles(...BATCH_ROLES)
  @Serialize(BatchResponseDto)
  @WarehouseListScope()
  @Get()
  findAll(
    @ScopedWarehouses() access: WarehouseAccess,
    @Query() query: QueryBatchDto,
  ) {
    return this.batchesService.findAll(access, query);
  }

  @Roles(...BATCH_ROLES)
  @WarehouseScope(WarehouseScopeSource.BATCH_PARAM)
  @Serialize(BatchResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.batchesService.findOne(id);
  }

  @Roles(...BATCH_ROLES)
  @WarehouseScope(WarehouseScopeSource.BATCH_PARAM, { requireShift: true })
  @Serialize(BatchResponseDto)
  @Audit({ action: 'batch.update', targetType: 'batch', entity: Batch })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateBatchDto: UpdateBatchDto) {
    return this.batchesService.update(id, updateBatchDto);
  }

  @Roles(...BATCH_ROLES)
  @WarehouseScope(WarehouseScopeSource.BATCH_PARAM, { requireShift: true })
  @Audit({ action: 'batch.remove', targetType: 'batch', entity: Batch })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.batchesService.remove(id);
  }

  // Bulk counterpart of DELETE /batches/:id: same roles, and the per-row
  // warehouse/shift check moves into the service (see bulkRemove there).
  @Roles(...BATCH_ROLES)
  @WarehouseListScope({ requireShift: true })
  @Audit({
    action: 'batch.remove',
    targetType: 'batch',
    entity: Batch,
    bulk: true,
  })
  @HttpCode(HttpStatus.OK)
  @Post('bulk-delete')
  bulkRemove(
    @Body() dto: BulkDeleteDto,
    @ScopedWarehouses() access: WarehouseAccess,
  ) {
    return this.batchesService.bulkRemove(dto.ids, access);
  }
}
