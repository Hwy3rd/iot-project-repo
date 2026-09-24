import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator';
import { Warehouse } from './entities/warehouse.entity';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { DeleteImageDto } from '../upload-files/dto/delete-image.dto';
import { imageUploadOptions } from '../upload-files/multer-image.options';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WarehouseResponseDto } from './dto/warehouse-response.dto';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Roles(UserRole.ADMIN)
  @Serialize(WarehouseResponseDto)
  @Audit({
    action: 'warehouse.create',
    targetType: 'warehouse',
    entity: Warehouse,
  })
  @Post()
  create(@Body() createWarehouseDto: CreateWarehouseDto) {
    return this.warehousesService.create(createWarehouseDto);
  }

  // No warehouse scope on the list endpoint: the service does not yet
  // filter results by the caller's assigned warehouses (see docs/rbac.md).
  @Serialize(WarehouseResponseDto)
  @Get()
  findAll() {
    return this.warehousesService.findAll();
  }

  @WarehouseScope(WarehouseScopeSource.WAREHOUSE_PARAM)
  @Serialize(WarehouseResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.warehousesService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(WarehouseResponseDto)
  @Audit({
    action: 'warehouse.update',
    targetType: 'warehouse',
    entity: Warehouse,
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWarehouseDto: UpdateWarehouseDto,
  ) {
    return this.warehousesService.update(id, updateWarehouseDto);
  }

  @Roles(UserRole.ADMIN)
  @Audit({
    action: 'warehouse.delete',
    targetType: 'warehouse',
    entity: Warehouse,
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.warehousesService.remove(id);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(WarehouseResponseDto)
  @Post(':id/images')
  @UseInterceptors(FilesInterceptor('files', 5, imageUploadOptions))
  addImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.warehousesService.addImages(id, files);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(WarehouseResponseDto)
  @Delete(':id/images')
  removeImage(@Param('id') id: string, @Body() dto: DeleteImageDto) {
    return this.warehousesService.removeImage(id, dto.url);
  }
}
