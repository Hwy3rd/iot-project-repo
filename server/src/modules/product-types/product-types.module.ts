import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadFilesModule } from '../upload-files/upload-files.module';
import { ProductType } from './entities/product-type.entity';
import { ProductTypesController } from './product-types.controller';
import { ProductTypesService } from './product-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductType]), UploadFilesModule],
  controllers: [ProductTypesController],
  providers: [ProductTypesService],
})
export class ProductTypesModule {}
