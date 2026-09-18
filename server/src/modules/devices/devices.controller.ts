import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { ClaimCodeResponseDto } from './dto/claim-code-response.dto';
import { ClaimDeviceDto } from './dto/claim-device.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { DeviceResponseDto } from './dto/device-response.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DevicesService } from './devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Serialize(DeviceResponseDto)
  @Post()
  create(@Body() createDeviceDto: CreateDeviceDto) {
    return this.devicesService.create(createDeviceDto);
  }

  @Serialize(DeviceResponseDto)
  @Get()
  findAll() {
    return this.devicesService.findAll();
  }

  @Serialize(DeviceResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Serialize(DeviceResponseDto)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDeviceDto: UpdateDeviceDto) {
    return this.devicesService.update(id, updateDeviceDto);
  }

  @Serialize(ClaimCodeResponseDto)
  @Post(':id/claim-code')
  generateClaimCode(@Param('id') id: string) {
    return this.devicesService.generateClaimCode(id);
  }

  @Serialize(DeviceResponseDto)
  @Post(':id/claim')
  claim(@Param('id') id: string, @Body() claimDeviceDto: ClaimDeviceDto) {
    return this.devicesService.claim(id, claimDeviceDto);
  }

  @Serialize(DeviceResponseDto)
  @Post(':id/decommission')
  decommission(@Param('id') id: string) {
    return this.devicesService.decommission(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.devicesService.remove(id);
  }
}
