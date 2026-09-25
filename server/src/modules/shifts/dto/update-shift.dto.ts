import { PartialType } from '@nestjs/mapped-types';
import { CreateShiftDto } from './create-shift.dto';

// WorkShift rows referencing this template are unaffected by time changes
// made after they were created, since they store their own snapshot.
export class UpdateShiftDto extends PartialType(CreateShiftDto) {}
