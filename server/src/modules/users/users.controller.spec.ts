import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../../libs/constants/user.constant';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  const usersService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    lock: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findOne to the service', async () => {
    usersService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(usersService.findOne).toHaveBeenCalledWith('1');
  });

  it('passes the caller to update so the service can guard role changes', async () => {
    await controller.update('s1', { fullName: 'B' }, 's1', UserRole.STAFF);

    expect(usersService.update).toHaveBeenCalledWith(
      's1',
      { fullName: 'B' },
      { id: 's1', role: UserRole.STAFF },
    );
  });

  it('passes the caller id to lock', async () => {
    await controller.lock('u1', 'a1');

    expect(usersService.lock).toHaveBeenCalledWith('u1', 'a1');
  });

  it('delegates remove to the service', async () => {
    await controller.remove('1');

    expect(usersService.remove).toHaveBeenCalledWith('1');
  });
});
