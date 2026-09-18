import { Test, TestingModule } from '@nestjs/testing';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';

describe('BatchesController', () => {
  let controller: BatchesController;
  const batchesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BatchesController],
      providers: [{ provide: BatchesService, useValue: batchesService }],
    }).compile();

    controller = module.get<BatchesController>(BatchesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findOne to the service', async () => {
    batchesService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(batchesService.findOne).toHaveBeenCalledWith('1');
  });

  it('delegates remove to the service', async () => {
    await controller.remove('1');

    expect(batchesService.remove).toHaveBeenCalledWith('1');
  });
});
