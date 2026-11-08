import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../libs/constants/metadata.constant';
import { UserRole } from '../../libs/constants/user.constant';
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

  it('lets every role send a command (Staff gated by shift in the scope guard)', () => {
    const create = Object.getOwnPropertyDescriptor(
      CommandsController.prototype,
      'create',
    )?.value as object;
    const roles = Reflect.getMetadata(ROLES_KEY, create) as UserRole[];

    expect(roles).toEqual(
      expect.arrayContaining([
        UserRole.ADMIN,
        UserRole.MANAGER,
        UserRole.TECHNICIAN,
        UserRole.STAFF,
      ]),
    );
  });
});
