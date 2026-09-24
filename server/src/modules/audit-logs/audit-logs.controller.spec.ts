import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../../libs/constants/user.constant';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsController', () => {
  let controller: AuditLogsController;
  const auditLogsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [{ provide: AuditLogsService, useValue: auditLogsService }],
    }).compile();

    controller = module.get<AuditLogsController>(AuditLogsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findAll to the service with the query params', async () => {
    const query = { userId: 'u1' };

    await controller.findAll(query, 'm1', UserRole.MANAGER);

    expect(auditLogsService.findAll).toHaveBeenCalledWith(query, {
      id: 'm1',
      role: UserRole.MANAGER,
    });
  });

  it('delegates findOne to the service', async () => {
    auditLogsService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1', 'a1', UserRole.ADMIN);

    expect(auditLogsService.findOne).toHaveBeenCalledWith('1', {
      id: 'a1',
      role: UserRole.ADMIN,
    });
  });
});
