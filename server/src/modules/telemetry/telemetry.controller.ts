import { Controller, Get, Param, Query } from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
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

  @Serialize(TelemetryHourlyResponseDto)
  @Get('hourly')
  findHourly(
    @Param('deviceId') deviceId: string,
    @Query() query: QueryTelemetryDto,
  ) {
    return this.telemetryService.findHourly(deviceId, query);
  }

  @Serialize(TelemetryRawResponseDto)
  @Get('raw')
  findRaw(
    @Param('deviceId') deviceId: string,
    @Query() query: QueryRawTelemetryDto,
  ) {
    return this.telemetryService.findRaw(deviceId, query);
  }
}
