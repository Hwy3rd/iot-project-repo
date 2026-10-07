import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Not } from 'typeorm';
import { DeviceStatus } from '../../libs/constants/device.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { AiPredictionService } from '../ai-prediction/ai-prediction.service';
import { Alert } from '../alerts/entities/alert.entity';
import { ChannelType } from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
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
  const coldRooms = { find: jest.fn(), findOne: jest.fn() };
  const devices = {
    createQueryBuilder: jest.fn(),
    find: jest.fn().mockResolvedValue([{ id: 'd1' }]),
  };
  const alerts = { createQueryBuilder: jest.fn() };
  const raw = { aggregate: jest.fn() };
  const channels = { find: jest.fn().mockResolvedValue([]) };
  const aiPrediction = {
    predict: jest.fn(),
    getLatest: jest.fn().mockResolvedValue(null),
  };

  const access = (warehouseIds: string[] | null) => ({
    userId: 'u1',
    role: warehouseIds ? UserRole.MANAGER : UserRole.ADMIN,
    warehouseIds,
    staffWarehouseIds: [],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    devices.find.mockResolvedValue([{ id: 'd1', coldRoomId: 'r1' }]);
    const module = await Test.createTestingModule({
      providers: [
        ColdRoomStatusService,
        { provide: getRepositoryToken(ColdRoom), useValue: coldRooms },
        { provide: getRepositoryToken(Device), useValue: devices },
        { provide: getRepositoryToken(Alert), useValue: alerts },
        { provide: getRepositoryToken(DeviceChannel), useValue: channels },
        { provide: getModelToken(TelemetryRaw.name), useValue: raw },
        { provide: AiPredictionService, useValue: aiPrediction },
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
        deviceId: 'd1',
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
    // Duplicate types (two fans) are reported once.
    channels.find.mockResolvedValue([
      { deviceId: 'd1', channelType: ChannelType.TEMP_HUMIDITY_SENSOR },
      { deviceId: 'd1', channelType: ChannelType.FAN_MOTOR },
      { deviceId: 'd1', channelType: ChannelType.FAN_MOTOR },
    ]);

    await expect(
      service.findStatuses({ coldRoomIds: ['r1', 'r2'] }, access(null)),
    ).resolves.toEqual([
      {
        coldRoomId: 'r1',
        warehouseId: 'w1',
        latest: {
          ts,
          deviceId: 'd1',
          declaredChannels: [
            ChannelType.TEMP_HUMIDITY_SENSOR,
            ChannelType.FAN_MOTOR,
          ],
          temperature: -19.5,
          doorOpen: false,
          sensorFault: false,
          outOfRange: false,
          // Stored before the device state fields existed -> not reported.
          humidity: null,
          fanOn: null,
          fanRelayOn: null,
          fanVoltage: null,
          fanPowerFault: null,
          fanFault: null,
          alarmActive: null,
          fanManualSec: null,
          buzzerManualSec: null,
          configSynced: null,
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

  it('only takes readings from devices installed in the room now', async () => {
    coldRooms.find.mockResolvedValue([
      { id: 'r1', warehouseId: 'w1' },
      { id: 'r2', warehouseId: 'w1' },
    ]);
    // d2 moved r1 -> r2: what it sent from r1 must not show up for r1.
    devices.find.mockResolvedValue([{ id: 'd2', coldRoomId: 'r2' }]);
    raw.aggregate.mockResolvedValue([]);
    devices.createQueryBuilder.mockReturnValue(rawQuery([]));
    alerts.createQueryBuilder.mockReturnValue(rawQuery([]));

    await service.findStatuses({ coldRoomIds: ['r1', 'r2'] }, access(null));

    expect(devices.find).toHaveBeenCalledWith({
      where: {
        coldRoomId: In(['r1', 'r2']),
        status: Not(DeviceStatus.DECOMMISSIONED),
      },
      select: { id: true, coldRoomId: true },
    });
    const [pipeline] = raw.aggregate.mock.calls[0] as [
      Record<string, Record<string, unknown>>[],
    ];
    expect(pipeline[0].$match).toEqual({
      $or: [{ coldRoomId: 'r2', deviceId: 'd2' }],
    });
  });

  it('has no latest reading when the room has no installed device', async () => {
    coldRooms.find.mockResolvedValue([{ id: 'r1', warehouseId: 'w1' }]);
    devices.find.mockResolvedValue([]);
    devices.createQueryBuilder.mockReturnValue(rawQuery([]));
    alerts.createQueryBuilder.mockReturnValue(rawQuery([]));

    const [status] = await service.findStatuses(
      { coldRoomIds: ['r1'] },
      access(null),
    );

    expect(status.latest).toBeNull();
    expect(raw.aggregate).not.toHaveBeenCalled();
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

  describe('findSeries', () => {
    it('throws NotFoundException for an unknown room', async () => {
      coldRooms.findOne.mockResolvedValue(null);
      await expect(service.findSeries('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('buckets the room samples by the range bucket size and rounds averages', async () => {
      coldRooms.findOne.mockResolvedValue({
        id: 'r1',
        tempMin: -22,
        tempMax: -18,
      });
      const t = new Date('2026-09-25T04:00:00Z');
      raw.aggregate.mockResolvedValue([
        {
          _id: t,
          avg: -19.456,
          min: -20,
          max: -19,
          samples: 12,
          outOfRange: 0,
          doorOpen: 1,
          sensorFault: 0,
        },
        {
          _id: new Date('2026-09-25T04:05:00Z'),
          avg: null,
          min: null,
          max: null,
          samples: 3,
          outOfRange: 0,
          doorOpen: 0,
          sensorFault: 3,
        },
      ]);

      const series = await service.findSeries('r1', '6h');

      const [pipeline] = raw.aggregate.mock.calls[0] as [
        Record<string, Record<string, unknown>>[],
      ];
      expect(pipeline[0].$match.coldRoomId).toBe('r1');
      expect(pipeline[1].$group._id).toEqual({
        $dateTrunc: { date: '$ts', unit: 'minute', binSize: 5 },
      });
      expect(series.to.getTime() - series.from.getTime()).toBe(6 * 60 * 60_000);
      expect(series).toMatchObject({
        coldRoomId: 'r1',
        bucketMinutes: 5,
        tempMin: -22,
        tempMax: -18,
        points: [
          { t, avg: -19.46, min: -20, max: -19, samples: 12, doorOpen: 1 },
          { avg: null, samples: 3, sensorFault: 3 },
        ],
      });
    });

    it('returns the stored AI prediction without calling the AI service', async () => {
      coldRooms.findOne.mockResolvedValue({
        id: 'r1',
        tempMin: -22,
        tempMax: -18,
      });
      raw.aggregate.mockResolvedValueOnce([]);
      const stored = {
        predictedTemp15m: -15.8,
        willExceedThreshold: true,
        violationType: 'OVERHEAT',
        riskLevel: 'CRITICAL',
        recommendation: 'Check compressor and ensure door is closed',
      };
      aiPrediction.getLatest.mockResolvedValueOnce(stored);

      const series = await service.findSeries('r1', '1h');

      expect(aiPrediction.getLatest).toHaveBeenCalledWith('r1');
      expect(aiPrediction.predict).not.toHaveBeenCalled();
      expect(series.prediction).toEqual(stored);
    });

    it('returns a null prediction when none is stored', async () => {
      coldRooms.findOne.mockResolvedValue({
        id: 'r1',
        tempMin: -22,
        tempMax: -18,
      });
      raw.aggregate.mockResolvedValueOnce([]);

      const series = await service.findSeries('r1', '1h');

      expect(series.prediction).toBeNull();
    });
  });
});
