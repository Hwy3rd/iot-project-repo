import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { Alert } from '../alerts/entities/alert.entity';
import { Device } from '../devices/entities/device.entity';
import { TelemetryRaw } from '../telemetry/schemas/telemetry-raw.schema';
import { ColdRoomStatusService } from './cold-room-status.service';
import { ColdRoom } from './entities/cold-room.entity';

// A chainable stand-in for TypeORM's query builder ending in getRawMany().
const rawQuery = (rows: unknown[]) => {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(rows);
  return qb;
};

describe('ColdRoomStatusService', () => {
  let service: ColdRoomStatusService;
  const coldRooms = { find: jest.fn() };
  const devices = { createQueryBuilder: jest.fn() };
  const alerts = { createQueryBuilder: jest.fn() };
  const raw = { aggregate: jest.fn() };

  const access = (warehouseIds: string[] | null) => ({
    userId: 'u1',
    role: warehouseIds ? UserRole.MANAGER : UserRole.ADMIN,
    warehouseIds,
    staffWarehouseIds: [],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ColdRoomStatusService,
        { provide: getRepositoryToken(ColdRoom), useValue: coldRooms },
        { provide: getRepositoryToken(Device), useValue: devices },
        { provide: getRepositoryToken(Alert), useValue: alerts },
        { provide: getModelToken(TelemetryRaw.name), useValue: raw },
      ],
    }).compile();
    service = module.get(ColdRoomStatusService);
  });

  it('requires coldRoomIds or warehouseIds', async () => {
    await expect(service.findStatuses({}, access(null))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('merges the latest reading, device counts and active alerts per room', async () => {
    coldRooms.find.mockResolvedValue([
      { id: 'r1', warehouseId: 'w1' },
      { id: 'r2', warehouseId: 'w1' },
    ]);
    const ts = new Date('2026-09-25T04:00:00Z');
    raw.aggregate.mockResolvedValue([
      {
        _id: 'r1',
        ts,
        temperature: -19.5,
        doorOpen: false,
        sensorFault: false,
        outOfRange: false,
      },
    ]);
    devices.createQueryBuilder.mockReturnValue(
      rawQuery([
        { coldRoomId: 'r1', status: 'active', n: '2' },
        { coldRoomId: 'r1', status: 'offline', n: '1' },
      ]),
    );
    alerts.createQueryBuilder.mockReturnValue(
      rawQuery([{ coldRoomId: 'r2', n: '3' }]),
    );

    await expect(
      service.findStatuses({ coldRoomIds: ['r1', 'r2'] }, access(null)),
    ).resolves.toEqual([
      {
        coldRoomId: 'r1',
        warehouseId: 'w1',
        latest: {
          ts,
          temperature: -19.5,
          doorOpen: false,
          sensorFault: false,
          outOfRange: false,
        },
        devices: { total: 3, active: 2, offline: 1 },
        activeAlerts: 0,
      },
      {
        coldRoomId: 'r2',
        warehouseId: 'w1',
        latest: null,
        devices: { total: 0 },
        activeAlerts: 3,
      },
    ]);
  });

  it('keeps the query inside the caller warehouse scope', async () => {
    coldRooms.find.mockResolvedValue([]);

    await service.findStatuses(
      { warehouseIds: ['w1', 'w2'] },
      access(['w2', 'w3']),
    );

    expect(coldRooms.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { warehouseId: In(['w2']) } }),
    );
  });

  it('returns nothing without touching the DB when no warehouse is in scope', async () => {
    await expect(
      service.findStatuses({ warehouseIds: ['w1'] }, access(['w9'])),
    ).resolves.toEqual([]);
    expect(coldRooms.find).not.toHaveBeenCalled();
  });
});
