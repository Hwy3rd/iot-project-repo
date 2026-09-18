import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CHANNEL_TYPE_ROLE } from '../../libs/constants/device-channel.constant';
import { CreateDeviceChannelDto } from './dto/create-device-channel.dto';
import { UpdateDeviceChannelDto } from './dto/update-device-channel.dto';
import { DeviceChannel } from './entities/device-channel.entity';
import { Device } from '../devices/entities/device.entity';

@Injectable()
export class DeviceChannelsService {
  constructor(
    @InjectRepository(DeviceChannel)
    private readonly channelsRepository: Repository<DeviceChannel>,
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
  ) {}

  private async assertDeviceExists(deviceId: string) {
    const device = await this.devicesRepository.findOne({
      where: { id: deviceId },
    });
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }
  }

  async create(
    deviceId: string,
    createDeviceChannelDto: CreateDeviceChannelDto,
  ) {
    await this.assertDeviceExists(deviceId);

    const channel = this.channelsRepository.create({
      deviceId,
      channelType: createDeviceChannelDto.channelType,
      channelRole: CHANNEL_TYPE_ROLE[createDeviceChannelDto.channelType],
      label: createDeviceChannelDto.label ?? null,
    });
    return this.channelsRepository.save(channel);
  }

  async findAllForDevice(deviceId: string) {
    await this.assertDeviceExists(deviceId);
    return this.channelsRepository.find({ where: { deviceId } });
  }

  async findOne(deviceId: string, id: string) {
    const channel = await this.channelsRepository.findOne({
      where: { id, deviceId },
    });
    if (!channel) {
      throw new NotFoundException(
        `Channel ${id} not found on device ${deviceId}`,
      );
    }
    return channel;
  }

  async update(
    deviceId: string,
    id: string,
    updateDeviceChannelDto: UpdateDeviceChannelDto,
  ) {
    const channel = await this.findOne(deviceId, id);
    Object.assign(channel, updateDeviceChannelDto);
    return this.channelsRepository.save(channel);
  }

  async remove(deviceId: string, id: string) {
    const result = await this.channelsRepository.delete({ id, deviceId });
    if (!result.affected) {
      throw new NotFoundException(
        `Channel ${id} not found on device ${deviceId}`,
      );
    }
  }
}
