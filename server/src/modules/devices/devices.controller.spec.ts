import { Test, TestingModule } from '@nestjs/testing';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

describe('DevicesController', () => {
  let controller: DevicesController;
  const devicesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    generateClaimCode: jest.fn(),
    claim: jest.fn(),
    decommission: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [{ provide: DevicesService, useValue: devicesService }],
    }).compile();

    controller = module.get<DevicesController>(DevicesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findOne to the service', async () => {
    devicesService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(devicesService.findOne).toHaveBeenCalledWith('1');
  });

  it('delegates generateClaimCode to the service', async () => {
    await controller.generateClaimCode('1');

    expect(devicesService.generateClaimCode).toHaveBeenCalledWith('1');
  });

  it('delegates claim to the service', async () => {
    const dto = { claimCode: '123456', coldRoomId: 'cr1' };

    await controller.claim('1', dto);

    expect(devicesService.claim).toHaveBeenCalledWith('1', dto);
  });

  it('delegates decommission to the service', async () => {
    await controller.decommission('1');

    expect(devicesService.decommission).toHaveBeenCalledWith('1');
  });

  it('delegates remove to the service', async () => {
    await controller.remove('1');

    expect(devicesService.remove).toHaveBeenCalledWith('1');
  });
});
