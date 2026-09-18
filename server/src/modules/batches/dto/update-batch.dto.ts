import { PartialType } from '@nestjs/mapped-types';
import { CreateBatchDto } from './create-batch.dto';

// status/removedAt are intentionally not editable here — they're only
// changed via BatchesService.remove(), which marks stock as taken out.
export class UpdateBatchDto extends PartialType(CreateBatchDto) {}
