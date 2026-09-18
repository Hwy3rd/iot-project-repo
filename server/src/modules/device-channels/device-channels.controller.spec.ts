import { Test, TestingModule } from '@nestjs/testing';
import { ChannelType } from '../../libs/constants/device-channel.constant';
import { DeviceChannelsController } from './device-channels.controller';
import { DeviceChannelsService } from './device-channels.service';

describe('DeviceChannelsController', () => {
  let controller: DeviceChannelsController;
  const deviceChannelsService = {
    create: jest.fn(),
    findAllForDevice: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceChannelsController],
      providers: [
        { provide: DeviceChannelsService, useValue: deviceChannelsService },
      ],
    }).compile();

    controller = module.get<DeviceChannelsController>(DeviceChannelsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates create to the service', async () => {
    const dto = { channelType: ChannelType.FAN_MOTOR };

    await controller.create('d1', dto);

    expect(deviceChannelsService.create).toHaveBeenCalledWith('d1', dto);
  });

  it('delegates findAll to the service', async () => {
    await controller.findAll('d1');

    expect(deviceChannelsService.findAllForDevice).toHaveBeenCalledWith('d1');
  });

  it('delegates findOne to the service', async () => {
    await controller.findOne('d1', 'c1');

    expect(deviceChannelsService.findOne).toHaveBeenCalledWith('d1', 'c1');
  });

  it('delegates remove to the service', async () => {
    await controller.remove('d1', 'c1');

    expect(deviceChannelsService.remove).toHaveBeenCalledWith('d1', 'c1');
  });
});
