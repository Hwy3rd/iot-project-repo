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
  @Post()
  create(@Body() createBatchDto: CreateBatchDto) {
    return this.batchesService.create(createBatchDto);
  }

  // No warehouse scope on the list endpoint: the service does not yet
  // filter results by the caller's assigned warehouses (see docs/rbac.md).
  @Roles(...BATCH_ROLES)
  @Serialize(BatchResponseDto)
  @Get()
  findAll() {
    return this.batchesService.findAll();
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
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateBatchDto: UpdateBatchDto) {
    return this.batchesService.update(id, updateBatchDto);
  }

  @Roles(...BATCH_ROLES)
  @WarehouseScope(WarehouseScopeSource.BATCH_PARAM, { requireShift: true })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.batchesService.remove(id);
  }
}
