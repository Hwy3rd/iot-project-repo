import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import {
  QueryRawTelemetryDto,
  QueryTelemetryDto,
} from './dto/query-telemetry.dto';
import { TelemetryHourlyResponseDto } from './dto/telemetry-hourly-response.dto';
import { TelemetryRawResponseDto } from './dto/telemetry-raw-response.dto';
import { TelemetryService } from './telemetry.service';

// Read-only: samples are written by the ingest path (TelemetryService.ingest),
// hourly buckets by the worker's rollup job.
@Controller('devices/:deviceId/telemetry')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  // Staff gets "cơ bản" telemetry (hourly only, requires an active shift);
  // raw/instant readings below are reserved for Admin/Manager/Technician.
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN, UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
    requireShift: true,
  })
  @Serialize(TelemetryHourlyResponseDto)
  @Get('hourly')
  findHourly(
    @Param('deviceId') deviceId: string,
    @Query() query: QueryTelemetryDto,
  ) {
    return this.telemetryService.findHourly(deviceId, query);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Serialize(TelemetryRawResponseDto)
  @Get('raw')
  findRaw(
    @Param('deviceId') deviceId: string,
    @Query() query: QueryRawTelemetryDto,
  ) {
    return this.telemetryService.findRaw(deviceId, query);
  }

  // The device's newest sample (null if it never reported) — an instant
  // reading, so same audience as `raw`. Drives the per-channel "last value /
  // no data" view of the device's declared channels.
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Serialize(TelemetryRawResponseDto)
  @Get('latest')
  findLatest(@Param('deviceId') deviceId: string) {
    return this.telemetryService.findLatest(deviceId);
  }
}
