import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateBatchDto } from './create-batch.dto';

// status/removedAt are intentionally not editable here — they're only
// changed via BatchesService.remove(), which marks stock as taken out.
// coldRoomId is immutable: there is no stock-transfer flow — moving goods
// means removing the batch and recording a new one in the target room.
// Being editable would also let stock be moved into a warehouse the caller
// has no rights in, since WarehouseScopeGuard only checks the current room.
export class UpdateBatchDto extends PartialType(
  OmitType(CreateBatchDto, ['coldRoomId'] as const),
) {}
