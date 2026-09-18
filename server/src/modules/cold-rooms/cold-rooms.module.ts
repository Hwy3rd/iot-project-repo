import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { ColdRoom } from './entities/cold-room.entity';
import { ColdRoomsService } from './cold-rooms.service';
import { ColdRoomsController } from './cold-rooms.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ColdRoom, Warehouse])],
  controllers: [ColdRoomsController],
  providers: [ColdRoomsService],
})
export class ColdRoomsModule {}
