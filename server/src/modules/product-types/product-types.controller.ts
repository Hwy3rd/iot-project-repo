import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { CreateProductTypeDto } from './dto/create-product-type.dto';
import { ProductTypeResponseDto } from './dto/product-type-response.dto';
import { UpdateProductTypeDto } from './dto/update-product-type.dto';
import { ProductTypesService } from './product-types.service';

@Controller('product-types')
export class ProductTypesController {
  constructor(private readonly productTypesService: ProductTypesService) {}

  @Serialize(ProductTypeResponseDto)
  @Post()
  create(@Body() createProductTypeDto: CreateProductTypeDto) {
    return this.productTypesService.create(createProductTypeDto);
  }

  @Serialize(ProductTypeResponseDto)
  @Get()
  findAll() {
    return this.productTypesService.findAll();
  }

  @Serialize(ProductTypeResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productTypesService.findOne(id);
  }

  @Serialize(ProductTypeResponseDto)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateProductTypeDto: UpdateProductTypeDto,
  ) {
    return this.productTypesService.update(id, updateProductTypeDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productTypesService.remove(id);
  }
}
