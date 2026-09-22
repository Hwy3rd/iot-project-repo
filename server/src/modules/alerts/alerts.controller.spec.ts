import { Test, TestingModule } from '@nestjs/testing';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

describe('AlertsController', () => {
  let controller: AlertsController;
  const alertsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    acknowledge: jest.fn(),
    resolveManual: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [{ provide: AlertsService, useValue: alertsService }],
    }).compile();

    controller = module.get<AlertsController>(AlertsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findAll to the service with the query', async () => {
    const query = { coldRoomId: 'c1' };
    alertsService.findAll.mockResolvedValue([{ id: 'a1' }]);

    await controller.findAll(query);

    expect(alertsService.findAll).toHaveBeenCalledWith(query);
  });

  it('delegates findOne to the service', async () => {
    alertsService.findOne.mockResolvedValue({ id: 'a1' });

    await controller.findOne('a1');

    expect(alertsService.findOne).toHaveBeenCalledWith('a1');
  });

  it('delegates acknowledge to the service', async () => {
    const dto = { userId: 'u1' };

    await controller.acknowledge('a1', dto);

    expect(alertsService.acknowledge).toHaveBeenCalledWith('a1', dto);
  });

  it('delegates resolve to resolveManual on the service', async () => {
    const dto = { userId: 'u1' };

    await controller.resolve('a1', dto);

    expect(alertsService.resolveManual).toHaveBeenCalledWith('a1', dto);
  });
});
