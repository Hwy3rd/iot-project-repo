import { Test, TestingModule } from '@nestjs/testing';
import { DeviceStatusHistoryController } from './device-status-history.controller';
import { DeviceStatusHistoryService } from './device-status-history.service';

describe('DeviceStatusHistoryController', () => {
  let controller: DeviceStatusHistoryController;
  const deviceStatusHistoryService = {
    findAllForDevice: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceStatusHistoryController],
      providers: [
        {
          provide: DeviceStatusHistoryService,
          useValue: deviceStatusHistoryService,
        },
      ],
    }).compile();

    controller = module.get<DeviceStatusHistoryController>(
      DeviceStatusHistoryController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findAll to the service scoped to the device', async () => {
    deviceStatusHistoryService.findAllForDevice.mockResolvedValue([]);

    await controller.findAll('d1');

    expect(deviceStatusHistoryService.findAllForDevice).toHaveBeenCalledWith(
      'd1',
    );
  });
});
