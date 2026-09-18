import { Test, TestingModule } from '@nestjs/testing';
import { CommandStatus } from '../../libs/constants/command.constant';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';

describe('CommandsController', () => {
  let controller: CommandsController;
  const commandsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    markSent: jest.fn(),
    acknowledge: jest.fn(),
    remove: jest.fn(),
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

  it('delegates markSent to the service', async () => {
    await controller.markSent('1');

    expect(commandsService.markSent).toHaveBeenCalledWith('1');
  });

  it('delegates acknowledge to the service', async () => {
    const dto = { status: CommandStatus.DONE as const };

    await controller.acknowledge('1', dto);

    expect(commandsService.acknowledge).toHaveBeenCalledWith('1', dto);
  });

  it('delegates remove to the service', async () => {
    await controller.remove('1');

    expect(commandsService.remove).toHaveBeenCalledWith('1');
  });
});
