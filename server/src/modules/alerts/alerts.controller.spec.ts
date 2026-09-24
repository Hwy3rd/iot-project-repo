import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../../libs/constants/user.constant';
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

    const access = {
      userId: 'u1',
      role: UserRole.MANAGER,
      warehouseIds: ['w1'],
      staffWarehouseIds: [],
    };

    await controller.findAll(query, access);

    expect(alertsService.findAll).toHaveBeenCalledWith(query, access);
  });

  it('delegates findOne to the service', async () => {
    alertsService.findOne.mockResolvedValue({ id: 'a1' });

    await controller.findOne('a1');

    expect(alertsService.findOne).toHaveBeenCalledWith('a1');
  });

  it('acknowledges as the authenticated caller', async () => {
    await controller.acknowledge('a1', 'u1');

    expect(alertsService.acknowledge).toHaveBeenCalledWith('a1', 'u1');
  });

  it('resolves as the authenticated caller', async () => {
    await controller.resolve('a1', 'u1');

    expect(alertsService.resolveManual).toHaveBeenCalledWith('a1', 'u1');
  });
});
