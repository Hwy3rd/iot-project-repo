import { Test, TestingModule } from '@nestjs/testing';
import { WorkShiftsController } from './work-shifts.controller';
import { WorkShiftsService } from './work-shifts.service';

describe('WorkShiftsController', () => {
  let controller: WorkShiftsController;
  const workShiftsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    checkIn: jest.fn(),
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

  it('delegates checkIn to the service', async () => {
    await controller.checkIn('1');

    expect(workShiftsService.checkIn).toHaveBeenCalledWith('1');
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
