import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { UploadFilesService } from '../upload-files/upload-files.service';
import { CreateProductTypeDto } from './dto/create-product-type.dto';
import { UpdateProductTypeDto } from './dto/update-product-type.dto';
import { ProductType } from './entities/product-type.entity';

@Injectable()
export class ProductTypesService {
  constructor(
    @InjectRepository(ProductType)
    private readonly productTypesRepository: Repository<ProductType>,
    private readonly uploadFilesService: UploadFilesService,
  ) {}

  private assertValidStorageRange(
    storageTempMin?: number | null,
    storageTempMax?: number | null,
  ) {
    if (
      storageTempMin != null &&
      storageTempMax != null &&
      storageTempMax <= storageTempMin
    ) {
      throw new BadRequestException(
        'storageTempMax must be greater than storageTempMin',
      );
    }
  }

  private async saveProductType(
    productType: ProductType,
  ): Promise<ProductType> {
    try {
      return await this.productTypesRepository.save(productType);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('Product type name already in use');
      }
      throw error;
    }
  }

  create(createProductTypeDto: CreateProductTypeDto) {
    this.assertValidStorageRange(
      createProductTypeDto.storageTempMin,
      createProductTypeDto.storageTempMax,
    );
    const productType = this.productTypesRepository.create({
      name: createProductTypeDto.name,
      category: createProductTypeDto.category ?? null,
      unit: createProductTypeDto.unit,
      storageTempMin: createProductTypeDto.storageTempMin ?? null,
      storageTempMax: createProductTypeDto.storageTempMax ?? null,
      imageUrls: createProductTypeDto.imageUrls ?? null,
    });
    return this.saveProductType(productType);
  }

  async findAll(
    query: PaginationQueryDto = {},
  ): Promise<Paginated<ProductType>> {
    const pagination = resolvePagination(query);
    const [items, total] = await this.productTypesRepository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const productType = await this.productTypesRepository.findOne({
      where: { id },
    });
    if (!productType) {
      throw new NotFoundException(`Product type ${id} not found`);
    }
    return productType;
  }

  async update(id: string, updateProductTypeDto: UpdateProductTypeDto) {
    const productType = await this.productTypesRepository.findOne({
      where: { id },
    });
    if (!productType) {
      throw new NotFoundException(`Product type ${id} not found`);
    }
    this.assertValidStorageRange(
      updateProductTypeDto.storageTempMin ?? productType.storageTempMin,
      updateProductTypeDto.storageTempMax ?? productType.storageTempMax,
    );
    Object.assign(productType, updateProductTypeDto);
    return this.saveProductType(productType);
  }

  async remove(id: string) {
    const result = await this.productTypesRepository.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Product type ${id} not found`);
    }
  }

  async addImages(id: string, files: Express.Multer.File[]) {
    const productType = await this.productTypesRepository.findOne({
      where: { id },
    });
    if (!productType) {
      throw new NotFoundException(`Product type ${id} not found`);
    }
    const uploaded = await this.uploadFilesService.uploadImages(
      files,
      'product-types',
    );
    productType.imageUrls = [...(productType.imageUrls ?? []), ...uploaded];
    return this.saveProductType(productType);
  }

  async removeImage(id: string, url: string) {
    const productType = await this.productTypesRepository.findOne({
      where: { id },
    });
    if (!productType) {
      throw new NotFoundException(`Product type ${id} not found`);
    }
    productType.imageUrls = (productType.imageUrls ?? []).filter(
      (img) => img !== url,
    );
    await this.uploadFilesService.deleteImage(url);
    return this.saveProductType(productType);
  }
}
