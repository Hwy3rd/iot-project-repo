import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator';
import { ProductType } from './entities/product-type.entity';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { DeleteImageDto } from '../upload-files/dto/delete-image.dto';
import { imageUploadOptions } from '../upload-files/multer-image.options';
import { CreateProductTypeDto } from './dto/create-product-type.dto';
import { ProductTypeResponseDto } from './dto/product-type-response.dto';
import { UpdateProductTypeDto } from './dto/update-product-type.dto';
import { QueryProductTypeDto } from './dto/query-product-type.dto';
import { ProductTypesService } from './product-types.service';

@Controller('product-types')
export class ProductTypesController {
  constructor(private readonly productTypesService: ProductTypesService) {}

  @Roles(UserRole.ADMIN)
  @Serialize(ProductTypeResponseDto)
  @Audit({
    action: 'product_type.create',
    targetType: 'product_type',
    entity: ProductType,
  })
  @Post()
  create(@Body() createProductTypeDto: CreateProductTypeDto) {
    return this.productTypesService.create(createProductTypeDto);
  }

  @Serialize(ProductTypeResponseDto)
  @Get()
  findAll(@Query() query: QueryProductTypeDto) {
    return this.productTypesService.findAll(query);
  }

  @Serialize(ProductTypeResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productTypesService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(ProductTypeResponseDto)
  @Audit({
    action: 'product_type.update',
    targetType: 'product_type',
    entity: ProductType,
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateProductTypeDto: UpdateProductTypeDto,
  ) {
    return this.productTypesService.update(id, updateProductTypeDto);
  }

  @Roles(UserRole.ADMIN)
  @Audit({
    action: 'product_type.delete',
    targetType: 'product_type',
    entity: ProductType,
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productTypesService.remove(id);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(ProductTypeResponseDto)
  @Post(':id/images')
  @UseInterceptors(FilesInterceptor('files', 5, imageUploadOptions))
  addImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.productTypesService.addImages(id, files);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(ProductTypeResponseDto)
  @Delete(':id/images')
  removeImage(@Param('id') id: string, @Body() dto: DeleteImageDto) {
    return this.productTypesService.removeImage(id, dto.url);
  }
}
