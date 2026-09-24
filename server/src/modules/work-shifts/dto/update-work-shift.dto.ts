import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateWorkShiftDto } from './create-work-shift.dto';

// status/checkInAt/checkOutAt are intentionally not editable here — they're
// only changed via WorkShiftsService.checkIn()/checkOut(). scheduledStartAt/
// scheduledEndAt are also not directly editable — they're recomputed from
// shiftId + workDate whenever either one changes.
// warehouseId is immutable: a shift in another warehouse is a new shift.
// Being editable would let a Manager schedule shifts in a warehouse they
// don't manage (WarehouseScopeGuard only checks the shift's current one).
// staffId stays editable — reassigning within the same warehouse.
export class UpdateWorkShiftDto extends PartialType(
  OmitType(CreateWorkShiftDto, ['warehouseId'] as const),
) {}
