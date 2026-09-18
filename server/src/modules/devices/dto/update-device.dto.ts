import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateDeviceDto } from './create-device.dto';

// uniqueId is the hardware identifier and immutable once registered — only
// firmwareVersion can be edited through the generic update endpoint.
// coldRoomId/status/claim fields change only through the dedicated
// claim-code/claim/decommission actions.
export class UpdateDeviceDto extends PartialType(
  OmitType(CreateDeviceDto, ['uniqueId']),
) {}
