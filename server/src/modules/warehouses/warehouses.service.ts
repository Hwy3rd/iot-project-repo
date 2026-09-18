import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { UploadFilesService } from '../upload-files/upload-files.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseStaff } from './entities/warehouse-staff.entity';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly uploadFilesService: UploadFilesService,
  ) {}

  private async saveWarehouse(warehouse: Warehouse): Promise<Warehouse> {
    try {
      return await this.warehousesRepository.save(warehouse);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('Warehouse name or code already in use');
      }
      throw error;
    }
  }

  create(createWarehouseDto: CreateWarehouseDto) {
    const warehouse = this.warehousesRepository.create({
      name: createWarehouseDto.name,
      code: createWarehouseDto.code,
      address: createWarehouseDto.address ?? null,
      imageUrls: createWarehouseDto.imageUrls ?? null,
    });
    return this.saveWarehouse(warehouse);
  }

  findAll() {
    return this.warehousesRepository.find();
  }

  async findOne(id: string) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    return warehouse;
  }

  async update(id: string, updateWarehouseDto: UpdateWarehouseDto) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    Object.assign(warehouse, updateWarehouseDto);
    return this.saveWarehouse(warehouse);
  }

  async addImages(id: string, files: Express.Multer.File[]) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    const uploaded = await this.uploadFilesService.uploadImages(
      files,
      'warehouses',
    );
    warehouse.imageUrls = [...(warehouse.imageUrls ?? []), ...uploaded];
    return this.saveWarehouse(warehouse);
  }

  async removeImage(id: string, url: string) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    warehouse.imageUrls = (warehouse.imageUrls ?? []).filter(
      (img) => img !== url,
    );
    await this.uploadFilesService.deleteImage(url);
    return this.saveWarehouse(warehouse);
  }

  // Soft-deleting a warehouse doesn't fire ON DELETE CASCADE (that only
  // triggers on a real SQL DELETE), so child rows have to be cleaned up here.
  async remove(id: string) {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.softDelete(Warehouse, id);
      if (!result.affected) {
        throw new NotFoundException(`Warehouse ${id} not found`);
      }
      await manager.softDelete(ColdRoom, { warehouseId: id });
      await manager.delete(WarehouseStaff, { warehouseId: id });
    });
  }
}
