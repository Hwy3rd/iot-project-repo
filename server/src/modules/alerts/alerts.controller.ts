import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { AlertsService } from './alerts.service';
import { AcknowledgeAlertDto } from './dto/acknowledge-alert.dto';
import { AlertResponseDto } from './dto/alert-response.dto';
import { QueryAlertDto } from './dto/query-alert.dto';
import { ResolveAlertDto } from './dto/resolve-alert.dto';

// No POST / here on purpose — alerts are raised internally by whatever
// detects an incident (see AlertsService.raise), never by a client request.
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Serialize(AlertResponseDto)
  @Get()
  findAll(@Query() query: QueryAlertDto) {
    return this.alertsService.findAll(query);
  }

  @Serialize(AlertResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.alertsService.findOne(id);
  }

  @Serialize(AlertResponseDto)
  @Post(':id/acknowledge')
  acknowledge(
    @Param('id') id: string,
    @Body() acknowledgeAlertDto: AcknowledgeAlertDto,
  ) {
    return this.alertsService.acknowledge(id, acknowledgeAlertDto);
  }

  @Serialize(AlertResponseDto)
  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() resolveAlertDto: ResolveAlertDto) {
    return this.alertsService.resolveManual(id, resolveAlertDto);
  }
}
