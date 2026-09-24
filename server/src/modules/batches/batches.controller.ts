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
import { Batch } from './entities/batch.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { BatchResponseDto } from './dto/batch-response.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { BatchesService } from './batches.service';

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
    @Query() query: PaginationQueryDto,
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
}
