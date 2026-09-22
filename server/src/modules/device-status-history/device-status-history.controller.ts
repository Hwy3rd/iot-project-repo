import { Controller, Get, Param } from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { DeviceStatusHistoryResponseDto } from './dto/device-status-history-response.dto';
import { DeviceStatusHistoryService } from './device-status-history.service';

// Read-only: rows are written internally (see DeviceStatusHistoryService.record),
// never via a client request.
@Controller('devices/:deviceId/status-history')
export class DeviceStatusHistoryController {
  constructor(
    private readonly deviceStatusHistoryService: DeviceStatusHistoryService,
  ) {}

  @Serialize(DeviceStatusHistoryResponseDto)
  @Get()
  findAll(@Param('deviceId') deviceId: string) {
    return this.deviceStatusHistoryService.findAllForDevice(deviceId);
  }
}
