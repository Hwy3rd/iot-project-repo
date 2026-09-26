import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { ProductType } from '../product-types/entities/product-type.entity';
import { Batch } from './entities/batch.entity';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';

@Module({
  imports: [TypeOrmModule.forFeature([Batch, ColdRoom, ProductType])],
  controllers: [BatchesController],
  providers: [BatchesService],
  // GET /cold-rooms/:id/inventory is served by ColdRoomsController.
  exports: [BatchesService],
})
export class BatchesModule {}
