import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateColdRoomDto } from './create-cold-room.dto';

// warehouseId is immutable: there is no move-between-warehouses flow — a
// room in another warehouse is created there instead. Being editable would
// also let a Manager push a room (with its devices and batches) into a
// warehouse they don't manage, since WarehouseScopeGuard only checks the
// room's current warehouse.
export class UpdateColdRoomDto extends PartialType(
  OmitType(CreateColdRoomDto, ['warehouseId'] as const),
) {}
