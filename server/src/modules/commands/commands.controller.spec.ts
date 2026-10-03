import { Test, TestingModule } from '@nestjs/testing';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';

describe('CommandsController', () => {
  let controller: CommandsController;
  const commandsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommandsController],
      providers: [{ provide: CommandsService, useValue: commandsService }],
    }).compile();

    controller = module.get<CommandsController>(CommandsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findOne to the service', async () => {
    commandsService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(commandsService.findOne).toHaveBeenCalledWith('1');
  });
});
