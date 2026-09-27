import { ForbiddenException } from '@nestjs/common';
import { FindOperator, In } from 'typeorm';
import { WarehouseAccessService } from '../../../common/rbac/warehouse-access.service';
import { DeviceStatus } from '../../../libs/constants/device.constant';
import { UserRole } from '../../../libs/constants/user.constant';
import { ChatbotToolExecutorService } from './chatbot-tool-executor.service';

const WAREHOUSES = [
  { id: 'w1', code: 'WH-HCM-01', name: 'Kho lạnh Tân Bình', address: null },
  { id: 'w2', code: 'WH-HN-01', name: 'Kho lạnh Long Biên', address: null },
  { id: 'w3', code: 'WH-DN-01', name: 'Kho lạnh Đà Nẵng', address: null },
];
// "Phòng A1" exists in two warehouses on purpose.
const ROOMS = [
  {
    id: 'cr1',
    warehouseId: 'w1',
    name: 'Phòng A1 – Cấp đông',
    tempMin: -22,
    tempMax: -18,
  },
  {
    id: 'cr2',
    warehouseId: 'w1',
    name: 'Phòng A2 – Mát',
    tempMin: 0,
    tempMax: 4,
  },
  {
    id: 'cr3',
    warehouseId: 'w2',
    name: 'Phòng B1 – Cấp đông',
    tempMin: -22,
    tempMax: -18,
  },
  {
    id: 'cr4',
    warehouseId: 'w3',
    name: 'Phòng A1 – Rau quả',
    tempMin: 2,
    tempMax: 6,
  },
];

// The ids an `In(...)` (or a plain value) in a where clause stands for.
const idsOf = (value: unknown): string[] | undefined =>
  value instanceof FindOperator
    ? (value.value as string[])
    : typeof value === 'string'
      ? [value]
      : undefined;

const inScope = <T extends { id: string }>(
  rows: T[],
  key: keyof T,
  where: Record<string, unknown> | undefined,
  whereKey: string,
) => {
  const ids = idsOf(where?.[whereKey]);
  return ids ? rows.filter((row) => ids.includes(row[key] as string)) : rows;
};

// Warehouse scoping and the model-facing behaviour of the tools: they must
// never reach more than the REST route they mirror (docs/RBAC.md §3), and
// names/codes are resolved within that scope only.
describe('ChatbotToolExecutorService', () => {
  let assignments: { warehouseId: string }[];
  let activeShiftWarehouses: string[];
  let workShiftsRepo: { find: jest.Mock; findAndCount: jest.Mock };
  let devicesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
  };
  let batchesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
  };
  let coldRoomsRepo: { find: jest.Mock };
  let alertsService: { findAll: jest.Mock };
  let coldRoomStatus: { findStatuses: jest.Mock };
  let alertsByType: { type: string; count: string }[];
  let service: ChatbotToolExecutorService;

  const repo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
  });

  const run = (name: string, args: Record<string, unknown>, role: UserRole) =>
    service.execute(name, args, { id: 'u1', role });

  beforeEach(() => {
    assignments = [];
    activeShiftWarehouses = [];
    alertsByType = [];
    const warehouseStaffRepo = {
      find: jest.fn(() => Promise.resolve(assignments)),
    };
    // Active-shift lookups (WarehouseAccessService) go through find and
    // always filter on checkOutAt; get_work_shifts uses findAndCount.
    workShiftsRepo = {
      find: jest.fn(({ where }: { where: { checkOutAt?: unknown } }) =>
        Promise.resolve(
          where && 'checkOutAt' in where
            ? activeShiftWarehouses.map((warehouseId) => ({ warehouseId }))
            : [],
        ),
      ),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    devicesRepo = repo();
    batchesRepo = repo();
    coldRoomsRepo = {
      find: jest.fn(({ where }: { where?: Record<string, unknown> }) =>
        Promise.resolve(inScope(ROOMS, 'warehouseId', where, 'warehouseId')),
      ),
    };
    const warehousesRepo = {
      find: jest.fn(({ where }: { where?: Record<string, unknown> }) =>
        Promise.resolve(inScope(WAREHOUSES, 'id', where, 'id')),
      ),
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(WAREHOUSES.find((w) => w.id === where.id) ?? null),
      ),
    };
    alertsService = {
      findAll: jest.fn().mockResolvedValue({ items: [], meta: { total: 0 } }),
    };
    coldRoomStatus = { findStatuses: jest.fn().mockResolvedValue([]) };
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => Promise.resolve(alertsByType)),
    };
    const alertsRepo = { createQueryBuilder: jest.fn(() => queryBuilder) };

    service = new ChatbotToolExecutorService(
      alertsService as never,
      {} as never,
      {} as never,
      devicesRepo as never,
      batchesRepo as never,
      coldRoomsRepo as never,
      warehousesRepo as never,
      repo() as never,
      repo() as never,
      repo() as never,
      workShiftsRepo as never,
      new WarehouseAccessService(
        warehouseStaffRepo as never,
        workShiftsRepo as never,
      ),
      coldRoomStatus as never,
      alertsRepo as never,
    );
  });

  describe('resolveWorkingWarehouse', () => {
    const caller = (role: UserRole) => ({ id: 'u1', role });

    it('returns a warehouse the caller is assigned to, whatever their role', async () => {
      assignments = [{ warehouseId: 'w1' }];

      await expect(
        service.resolveWorkingWarehouse(caller(UserRole.STAFF), 'w1'),
      ).resolves.toMatchObject({ code: 'WH-HCM-01' });
    });

    it('refuses one they are not assigned to, like an unknown id', async () => {
      assignments = [{ warehouseId: 'w1' }];

      await expect(
        service.resolveWorkingWarehouse(caller(UserRole.MANAGER), 'w2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.resolveWorkingWarehouse(caller(UserRole.MANAGER), 'nope'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets Admin pick any existing warehouse', async () => {
      await expect(
        service.resolveWorkingWarehouse(caller(UserRole.ADMIN), 'w3'),
      ).resolves.toMatchObject({ code: 'WH-DN-01' });
    });
  });

  describe('scoping', () => {
    it('refuses a device-log tool to someone who is only Staff anywhere', async () => {
      assignments = [{ warehouseId: 'w1' }];

      const result = await run(
        'get_telemetry_raw',
        { deviceId: 'd1' },
        UserRole.STAFF,
      );

      expect(result.error).toBe('Bạn không có quyền sử dụng chức năng này.');
    });

    it('refuses batches to a Technician (no stock operations)', async () => {
      assignments = [{ warehouseId: 'w1' }];

      const result = await run('get_batches', {}, UserRole.TECHNICIAN);

      expect(result.error).toBe('Bạn không có quyền sử dụng chức năng này.');
      expect(batchesRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('hides devices from Staff who are not checked into a shift', async () => {
      assignments = [{ warehouseId: 'w1' }];
      activeShiftWarehouses = [];

      const result = await run('get_devices', {}, UserRole.STAFF);

      expect(result.error).toContain('cần đang trong ca trực');
    });

    it('shows devices of the warehouse where Staff is checked in', async () => {
      assignments = [{ warehouseId: 'w1' }, { warehouseId: 'w2' }];
      activeShiftWarehouses = ['w2'];

      await run('get_devices', {}, UserRole.STAFF);

      expect(devicesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { coldRoomId: In(['cr3']) } }),
      );
    });

    it('refuses device logs from a warehouse the caller is not assigned to', async () => {
      assignments = [{ warehouseId: 'w3' }];
      // d1 lives in cr1 (w1).
      devicesRepo.findOne.mockResolvedValue({ id: 'd1', coldRoomId: 'cr1' });

      const result = await run(
        'get_telemetry_raw',
        { deviceId: 'd1' },
        UserRole.TECHNICIAN,
      );

      expect(result.error).toContain('không có quyền truy cập tài nguyên này');
    });

    it('shows a Manager every shift in their warehouses, and Staff only their own', async () => {
      assignments = [{ warehouseId: 'w1' }, { warehouseId: 'w2' }];

      await run('get_work_shifts', { staffId: 'someone' }, UserRole.MANAGER);
      expect(workShiftsRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: [{ warehouseId: In(['w1', 'w2']), staffId: 'someone' }],
        }),
      );

      await run('get_work_shifts', { staffId: 'someone' }, UserRole.STAFF);
      expect(workShiftsRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: [{ warehouseId: In(['w1', 'w2']), staffId: 'u1' }],
        }),
      );
    });

    it('lists alerts across all reachable warehouses in a single query', async () => {
      assignments = [{ warehouseId: 'w1' }, { warehouseId: 'w2' }];

      await run('get_alerts', { status: 'open' }, UserRole.MANAGER);

      expect(alertsService.findAll).toHaveBeenCalledTimes(1);
      const [query, access] = alertsService.findAll.mock.calls[0] as [
        { status: string },
        { warehouseIds: string[] },
      ];
      expect(query.status).toBe('open');
      expect(access.warehouseIds).toEqual(['w1', 'w2']);
    });
  });

  describe('names and codes instead of ids', () => {
    it('finds a room by an accent-free partial name, within scope only', async () => {
      // cr4 ("Phòng A1 – Rau quả") is in w3, outside this Manager's scope.
      assignments = [{ warehouseId: 'w1' }];

      await run('get_devices', { coldRoomId: 'phong a1' }, UserRole.MANAGER);

      expect(devicesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { coldRoomId: In(['cr1']) } }),
      );
    });

    it('lists the candidates when a name matches several rooms', async () => {
      const result = await run(
        'get_devices',
        { coldRoomId: 'Phòng A1' },
        UserRole.ADMIN,
      );

      expect(result.error).toContain('Có 2 phòng lạnh khớp "Phòng A1"');
      expect(result.error).toContain('Phòng A1 – Cấp đông (WH-HCM-01)');
      expect(result.error).toContain('Phòng A1 – Rau quả (WH-DN-01)');
      expect(devicesRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('matches the words of a room name said out of sequence', async () => {
      assignments = [{ warehouseId: 'w3' }];

      await run('get_devices', { coldRoomId: 'phòng rau' }, UserRole.MANAGER);

      expect(devicesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { coldRoomId: In(['cr4']) } }),
      );
    });

    it("settles a shared room name on the header's warehouse", async () => {
      await service.execute(
        'get_devices',
        { coldRoomId: 'Phòng A1' },
        { id: 'u1', role: UserRole.ADMIN, workingWarehouseId: 'w3' },
      );

      expect(devicesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { coldRoomId: In(['cr4']) } }),
      );
    });

    it('narrows an ambiguous room name by the warehouse given with it', async () => {
      await run(
        'get_devices',
        { warehouseId: 'WH-DN-01', coldRoomId: 'Phòng A1' },
        UserRole.ADMIN,
      );

      expect(devicesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { coldRoomId: In(['cr4']) } }),
      );
    });

    it("treats a room outside the caller's warehouses as not found", async () => {
      assignments = [{ warehouseId: 'w1' }];

      const result = await run(
        'get_cold_room_detail',
        { coldRoomId: 'Phòng B1' },
        UserRole.MANAGER,
      );

      expect(result.error).toContain('không có quyền truy cập tài nguyên này');
      expect(coldRoomStatus.findStatuses).not.toHaveBeenCalled();
    });

    it('filters devices by warehouse code and status in one query', async () => {
      assignments = [{ warehouseId: 'w1' }, { warehouseId: 'w2' }];

      await run(
        'get_devices',
        { warehouseId: 'wh-hcm-01', status: 'offline' },
        UserRole.TECHNICIAN,
      );

      expect(devicesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { coldRoomId: In(['cr1', 'cr2']), status: 'offline' },
        }),
      );
    });

    it('looks a device up by id or uniqueId', async () => {
      assignments = [{ warehouseId: 'w1' }];
      devicesRepo.findOne.mockResolvedValue({
        id: 'd1',
        uniqueId: 'ESP32-A1',
        coldRoomId: 'cr1',
        status: DeviceStatus.ACTIVE,
      });

      const result = await run(
        'get_device_detail',
        { deviceId: 'ESP32-A1' },
        UserRole.TECHNICIAN,
      );

      expect(devicesRepo.findOne).toHaveBeenCalledWith({
        where: [{ id: 'ESP32-A1' }, { uniqueId: 'ESP32-A1' }],
      });
      expect(result.result).toMatchObject({
        uniqueId: 'ESP32-A1',
        coldRoom: 'Phòng A1 – Cấp đông',
        warehouse: 'WH-HCM-01',
      });
    });
  });

  describe('results', () => {
    it('names the room and warehouse, hides claim secrets and says when a list is cut', async () => {
      assignments = [{ warehouseId: 'w1' }];
      devicesRepo.findAndCount.mockResolvedValue([
        [
          {
            id: 'd1',
            uniqueId: 'ESP32-A1',
            coldRoomId: 'cr2',
            status: DeviceStatus.OFFLINE,
            claimCodeHash: 'secret',
          },
        ],
        5,
      ]);

      const result = await run(
        'get_devices',
        { limit: 1 },
        UserRole.TECHNICIAN,
      );

      expect(devicesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
      const output = result.result as {
        total: number;
        items: Record<string, unknown>[];
        note?: string;
      };
      expect(output.total).toBe(5);
      expect(output.note).toContain('1/5');
      expect(output.items[0]).toMatchObject({
        coldRoom: 'Phòng A2 – Mát',
        warehouse: 'WH-HCM-01',
      });
      expect(output.items[0]).not.toHaveProperty('claimCodeHash');
    });

    it('finds in-stock batches expiring within N days', async () => {
      assignments = [{ warehouseId: 'w1' }];

      await run('get_batches', { expiringWithinDays: 7 }, UserRole.MANAGER);

      const [options] = batchesRepo.findAndCount.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(options.where.status).toBe('in_stock');
      expect(options.where.expiryDate).toBeInstanceOf(FindOperator);
      expect(options.where.coldRoomId).toEqual(In(['cr1', 'cr2']));
    });

    it('answers cold rooms from the scope without another query', async () => {
      assignments = [{ warehouseId: 'w2' }];

      const result = await run('get_cold_rooms', {}, UserRole.MANAGER);

      expect(result.result).toEqual({
        total: 1,
        items: [
          {
            id: 'cr3',
            name: 'Phòng B1 – Cấp đông',
            warehouse: 'WH-HN-01',
            tempMin: -22,
            tempMax: -18,
          },
        ],
      });
      expect(coldRoomsRepo.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('get_cold_room_detail', () => {
    it('says outright when a room has no recent reading', async () => {
      coldRoomStatus.findStatuses.mockResolvedValue([
        {
          coldRoomId: 'cr3',
          warehouseId: 'w2',
          latest: null,
          devices: { total: 1, active: 1 },
          activeAlerts: 0,
        },
      ]);

      const result = await run(
        'get_cold_room_detail',
        { coldRoomId: 'phòng b1' },
        UserRole.ADMIN,
      );

      const output = result.result as {
        name: string;
        current: { latest: null; note: string };
      };
      expect(output.name).toBe('Phòng B1 – Cấp đông');
      expect(output.current.latest).toBeNull();
      expect(output.current.note).toContain(
        'Không có mẫu cảm biến nào gần đây',
      );
    });
  });

  describe('get_system_health_summary', () => {
    it('counts warehouses that have no cold room yet', async () => {
      const result = (
        await run('get_system_health_summary', {}, UserRole.ADMIN)
      ).result as { warehouses: number };

      expect(result.warehouses).toBe(3);
    });

    const now = Date.now();

    it("reports only the caller's rooms, with what needs attention", async () => {
      assignments = [{ warehouseId: 'w1' }];
      coldRoomStatus.findStatuses.mockResolvedValue([
        {
          coldRoomId: 'cr1',
          warehouseId: 'w1',
          latest: {
            ts: new Date(now - 60_000),
            temperature: -12,
            doorOpen: true,
            sensorFault: false,
            outOfRange: true,
          },
          devices: { total: 2, active: 1, offline: 1 },
          activeAlerts: 2,
        },
        {
          coldRoomId: 'cr2',
          warehouseId: 'w1',
          latest: {
            ts: new Date(now - 60_000),
            temperature: 2,
            doorOpen: false,
            sensorFault: false,
            outOfRange: false,
          },
          devices: { total: 1, active: 1 },
          activeAlerts: 0,
        },
      ]);
      alertsByType = [{ type: 'temperature_out_of_range', count: '2' }];
      devicesRepo.findAndCount.mockResolvedValue([
        [
          {
            id: 'd9',
            uniqueId: 'ESP32-X',
            coldRoomId: 'cr1',
            status: 'offline',
          },
        ],
        1,
      ]);

      const result = (
        await run('get_system_health_summary', {}, UserRole.MANAGER)
      ).result as Record<string, unknown>;

      expect(coldRoomStatus.findStatuses).toHaveBeenCalledWith(
        { coldRoomIds: ['cr1', 'cr2'] },
        expect.anything(),
      );
      expect(result).toMatchObject({
        warehouses: 1,
        coldRooms: 2,
        devices: { total: 3, byStatus: { active: 2, offline: 1 } },
        activeAlerts: { total: 2, byType: { temperature_out_of_range: 2 } },
        roomsOk: 1,
        roomsNeedingAttention: {
          total: 1,
          items: [
            {
              coldRoom: 'Phòng A1 – Cấp đông',
              warehouse: 'WH-HCM-01',
              temperature: -12,
              reasons: [
                'nhiệt độ -12°C ngoài ngưỡng -22..-18°C',
                'cửa đang mở',
                '1 thiết bị offline/lỗi/bảo trì',
                '2 cảnh báo chưa xử lý',
              ],
            },
          ],
        },
        problemDevices: {
          total: 1,
          items: [{ uniqueId: 'ESP32-X', coldRoom: 'Phòng A1 – Cấp đông' }],
        },
      });
    });

    it('flags a room whose last reading is stale instead of judging it', async () => {
      assignments = [{ warehouseId: 'w2' }];
      coldRoomStatus.findStatuses.mockResolvedValue([
        {
          coldRoomId: 'cr3',
          warehouseId: 'w2',
          latest: {
            ts: new Date(now - 30 * 60_000),
            temperature: -5,
            doorOpen: false,
            sensorFault: false,
            outOfRange: true,
          },
          devices: { total: 1, active: 1 },
          activeAlerts: 0,
        },
      ]);

      const result = (
        await run('get_system_health_summary', {}, UserRole.MANAGER)
      ).result as { roomsNeedingAttention: { items: { reasons: string[] }[] } };

      expect(result.roomsNeedingAttention.items[0].reasons).toEqual([
        'mất tín hiệu 30 phút',
      ]);
    });
  });
});
