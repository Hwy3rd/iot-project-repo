import { In } from 'typeorm';
import { WarehouseAccessService } from '../../../common/rbac/warehouse-access.service';
import { UserRole } from '../../../libs/constants/user.constant';
import { ChatbotToolExecutorService } from './chatbot-tool-executor.service';

// Warehouse scoping only: tools must never reach more than the REST route
// they mirror, under the per-warehouse role model (docs/RBAC.md §3), via
// the same WarehouseAccessService the guards use.
describe('ChatbotToolExecutorService scoping', () => {
  let assignments: { warehouseId: string; role: UserRole }[];
  let activeShiftWarehouses: string[];
  let workShiftsRepo: { find: jest.Mock };
  let devicesRepo: { find: jest.Mock; findOne: jest.Mock };
  let batchesRepo: { find: jest.Mock; findOne: jest.Mock };
  let coldRoomsRepo: { find: jest.Mock; findOne: jest.Mock };
  let alertsService: { findAll: jest.Mock };
  let service: ChatbotToolExecutorService;

  const repo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  });

  beforeEach(() => {
    assignments = [];
    activeShiftWarehouses = [];
    const warehouseStaffRepo = {
      find: jest.fn(() => Promise.resolve(assignments)),
    };
    // Active-shift lookups (WarehouseAccessService) and get_work_shifts
    // both go through this repo; the former always filters on checkInAt.
    workShiftsRepo = {
      find: jest.fn(({ where }: { where: { checkInAt?: unknown } }) =>
        Promise.resolve(
          where && 'checkInAt' in where
            ? activeShiftWarehouses.map((warehouseId) => ({ warehouseId }))
            : [],
        ),
      ),
    };
    devicesRepo = repo();
    batchesRepo = repo();
    coldRoomsRepo = repo();
    alertsService = { findAll: jest.fn().mockResolvedValue([]) };

    service = new ChatbotToolExecutorService(
      alertsService as never,
      {} as never,
      {} as never,
      devicesRepo as never,
      batchesRepo as never,
      coldRoomsRepo as never,
      repo() as never,
      repo() as never,
      repo() as never,
      repo() as never,
      workShiftsRepo as never,
      new WarehouseAccessService(
        warehouseStaffRepo as never,
        workShiftsRepo as never,
      ),
    );
  });

  it('refuses a device-log tool to someone who is only Staff anywhere', async () => {
    assignments = [{ warehouseId: 'w1', role: UserRole.STAFF }];

    const result = await service.execute(
      'get_telemetry_raw',
      { deviceId: 'd1' },
      { id: 'u1', role: UserRole.STAFF },
    );

    expect(result.error).toBe('Bạn không có quyền sử dụng chức năng này.');
  });

  it('refuses batches to a Technician (no stock operations)', async () => {
    assignments = [{ warehouseId: 'w1', role: UserRole.TECHNICIAN }];

    const result = await service.execute(
      'get_batches',
      {},
      { id: 'u1', role: UserRole.TECHNICIAN },
    );

    expect(result.error).toBe('Bạn không có quyền sử dụng chức năng này.');
    expect(batchesRepo.find).not.toHaveBeenCalled();
  });

  it('hides devices from Staff who are not checked into a shift', async () => {
    assignments = [{ warehouseId: 'w1', role: UserRole.STAFF }];
    activeShiftWarehouses = [];

    const result = await service.execute(
      'get_devices',
      {},
      { id: 'u1', role: UserRole.STAFF },
    );

    expect(result.error).toContain('cần đang trong ca trực');
  });

  it('shows devices of the warehouse where Staff is checked in', async () => {
    assignments = [
      { warehouseId: 'w1', role: UserRole.STAFF },
      { warehouseId: 'w2', role: UserRole.STAFF },
    ];
    activeShiftWarehouses = ['w2'];
    coldRoomsRepo.find.mockResolvedValue([{ id: 'cr2' }]);

    await service.execute(
      'get_devices',
      {},
      { id: 'u1', role: UserRole.STAFF },
    );

    expect(coldRoomsRepo.find).toHaveBeenCalledWith({
      where: { warehouseId: In(['w2']) },
    });
  });

  it('lets a global Staff who is Technician in w3 read device logs there only', async () => {
    assignments = [
      { warehouseId: 'w1', role: UserRole.STAFF },
      { warehouseId: 'w3', role: UserRole.TECHNICIAN },
    ];
    // d1 lives in w1, where this user is only Staff.
    devicesRepo.findOne.mockResolvedValue({ id: 'd1', coldRoomId: 'cr1' });
    coldRoomsRepo.findOne.mockResolvedValue({ id: 'cr1', warehouseId: 'w1' });

    const result = await service.execute(
      'get_telemetry_raw',
      { deviceId: 'd1' },
      { id: 'u1', role: UserRole.STAFF },
    );

    expect(result.error).toContain('không có quyền truy cập tài nguyên này');
  });

  it('shows all shifts where the caller manages, only their own where they are Staff', async () => {
    assignments = [
      { warehouseId: 'w1', role: UserRole.MANAGER },
      { warehouseId: 'w2', role: UserRole.STAFF },
    ];

    await service.execute(
      'get_work_shifts',
      { staffId: 'someone' },
      { id: 'u1', role: UserRole.MANAGER },
    );

    expect(workShiftsRepo.find).toHaveBeenLastCalledWith({
      where: [
        { warehouseId: In(['w1']), staffId: 'someone' },
        { warehouseId: In(['w2']), staffId: 'u1' },
      ],
      order: { workDate: 'DESC' },
    });
  });

  it('lists alerts across all reachable warehouses in a single query', async () => {
    assignments = [
      { warehouseId: 'w1', role: UserRole.MANAGER },
      { warehouseId: 'w2', role: UserRole.TECHNICIAN },
    ];

    await service.execute(
      'get_alerts',
      { status: 'open' },
      { id: 'u1', role: UserRole.MANAGER },
    );

    expect(alertsService.findAll).toHaveBeenCalledTimes(1);
    const [query, access] = alertsService.findAll.mock.calls[0] as [
      { status: string },
      { warehouseIds: string[] },
    ];
    expect(query.status).toBe('open');
    expect(access.warehouseIds).toEqual(['w1', 'w2']);
  });
});
