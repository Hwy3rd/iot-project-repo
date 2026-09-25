import { Test, TestingModule } from '@nestjs/testing';
import { ColdRoomsController } from './cold-rooms.controller';
import { ColdRoomStatusService } from './cold-room-status.service';
import { ColdRoomsService } from './cold-rooms.service';

describe('ColdRoomsController', () => {
  let controller: ColdRoomsController;
  const coldRoomsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ColdRoomsController],
      providers: [
        { provide: ColdRoomsService, useValue: coldRoomsService },
        {
          provide: ColdRoomStatusService,
          useValue: { findStatuses: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<ColdRoomsController>(ColdRoomsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findOne to the service', async () => {
    coldRoomsService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(coldRoomsService.findOne).toHaveBeenCalledWith('1');
  });

  it('delegates remove to the service', async () => {
    await controller.remove('1');

    expect(coldRoomsService.remove).toHaveBeenCalledWith('1');
  });
});
