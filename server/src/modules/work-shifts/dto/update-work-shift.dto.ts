import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkShiftDto } from './create-work-shift.dto';

// status/checkInAt/checkOutAt are intentionally not editable here — they're
// only changed via WorkShiftsService.checkIn()/checkOut(). scheduledStartAt/
// scheduledEndAt are also not directly editable — they're recomputed from
// shiftId + workDate whenever either one changes.
export class UpdateWorkShiftDto extends PartialType(CreateWorkShiftDto) {}
