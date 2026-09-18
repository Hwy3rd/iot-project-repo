import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsController', () => {
  let controller: AuditLogsController;
  const auditLogsService = {
    create: jest.fn(),
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

    await controller.findAll(query);

    expect(auditLogsService.findAll).toHaveBeenCalledWith(query);
  });

  it('delegates findOne to the service', async () => {
    auditLogsService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(auditLogsService.findOne).toHaveBeenCalledWith('1');
  });
});
