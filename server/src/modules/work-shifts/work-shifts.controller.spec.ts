import { Test, TestingModule } from '@nestjs/testing';
import { WorkShiftsController } from './work-shifts.controller';
import { WorkShiftsService } from './work-shifts.service';

describe('WorkShiftsController', () => {
  let controller: WorkShiftsController;
  const workShiftsService = {
    attendance: jest.fn(),
    checkIn: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    checkOut: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkShiftsController],
      providers: [{ provide: WorkShiftsService, useValue: workShiftsService }],
    }).compile();

    controller = module.get<WorkShiftsController>(WorkShiftsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findOne to the service', async () => {
    workShiftsService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(workShiftsService.findOne).toHaveBeenCalledWith('1');
  });

  it("reads the caller's own attendance", async () => {
    await controller.attendance('u1');

    expect(workShiftsService.attendance).toHaveBeenCalledWith('u1');
  });

  it('checks the caller in to the warehouse in the body', async () => {
    await controller.checkIn('u1', { warehouseId: 'w1' });

    expect(workShiftsService.checkIn).toHaveBeenCalledWith('u1', 'w1');
  });

  it('approves and rejects as the calling reviewer', async () => {
    await controller.approve('1', 'm1');
    await controller.reject('1', 'm1', { reason: 'Sai kho' });

    expect(workShiftsService.approve).toHaveBeenCalledWith('1', 'm1');
    expect(workShiftsService.reject).toHaveBeenCalledWith('1', 'm1', 'Sai kho');
  });

  it('delegates checkOut to the service', async () => {
    await controller.checkOut('1');

    expect(workShiftsService.checkOut).toHaveBeenCalledWith('1');
  });

  it('delegates remove to the service', async () => {
    await controller.remove('1');

    expect(workShiftsService.remove).toHaveBeenCalledWith('1');
  });
});
