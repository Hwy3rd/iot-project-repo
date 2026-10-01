import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertType } from '../../libs/constants/alert.constant';
import { DeviceStatus } from '../../libs/constants/device.constant';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AlertsService } from '../alerts/alerts.service';
import { Device } from '../devices/entities/device.entity';
import { AiPredictionService } from '../ai-prediction/ai-prediction.service';
import { TelemetryHourly } from './schemas/telemetry-hourly.schema';
import { TelemetryRaw } from './schemas/telemetry-raw.schema';
import { TelemetryService } from './telemetry.service';

// find().sort().limit().lean().exec() — each step returns the same chain.
const createQueryChain = (result: unknown[] = []) => {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
  return chain;
};

describe('TelemetryService', () => {
  let service: TelemetryService;
  let rawModel: { create: jest.Mock; find: jest.Mock };
  let hourlyModel: { find: jest.Mock };
  let devicesRepository: { findOne: jest.Mock; existsBy: jest.Mock };
  let alertsService: { raise: jest.Mock; resolveAuto: jest.Mock };
  let realtime: { emitToWarehouse: jest.Mock };

  // tempMax=-15, hysteresis=1 → the alert only auto-resolves at <= -16, not
  // merely back inside [-20,-15] — see the "hysteresis band" tests below.
  const activeDevice = {
    id: 'd1',
    status: DeviceStatus.ACTIVE,
    coldRoom: {
      id: 'c1',
      warehouseId: 'w1',
      tempMin: -20,
      tempMax: -15,
      hysteresis: 1,
    },
  };
  const sample = {
    ts: new Date('2026-09-21T10:00:05.000Z'),
    temperature: -18,
    doorOpen: false,
    sensorFault: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        {
          provide: getModelToken(TelemetryRaw.name),
          useValue: { create: jest.fn(), find: jest.fn() },
        },
        {
          provide: getModelToken(TelemetryHourly.name),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(Device),
          useValue: { findOne: jest.fn(), existsBy: jest.fn() },
        },
        {
          provide: AlertsService,
          useValue: { raise: jest.fn(), resolveAuto: jest.fn() },
        },
        {
          provide: RealtimeGateway,
          useValue: { emitToWarehouse: jest.fn() },
        },
        {
          provide: AiPredictionService,
          useValue: { predict: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(TelemetryService);
    rawModel = module.get(getModelToken(TelemetryRaw.name));
    hourlyModel = module.get(getModelToken(TelemetryHourly.name));
    devicesRepository = module.get(getRepositoryToken(Device));
    alertsService = module.get(AlertsService);
    realtime = module.get(RealtimeGateway);
  });

  describe('ingest', () => {
    it('pushes the stored reading to the warehouse room', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);
      rawModel.create.mockResolvedValue({});

      await service.ingest('d1', sample);

      expect(realtime.emitToWarehouse).toHaveBeenCalledWith(
        'w1',
        'coldroom:reading',
        {
          warehouseId: 'w1',
          coldRoomId: 'c1',
          deviceId: 'd1',
          latest: {
            ts: sample.ts,
            temperature: -18,
            doorOpen: false,
            sensorFault: false,
            outOfRange: false,
          },
        },
      );
    });

    it('does not push a redelivered (duplicate) sample', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);
      rawModel.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );

      await expect(service.ingest('d1', sample)).resolves.toEqual({
        stored: false,
      });
      expect(realtime.emitToWarehouse).not.toHaveBeenCalled();
    });

    it('still stores the sample when the realtime push throws', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);
      rawModel.create.mockResolvedValue({});
      realtime.emitToWarehouse.mockImplementation(() => {
        throw new Error('socket server not ready');
      });

      await expect(service.ingest('d1', sample)).resolves.toEqual({
        stored: true,
      });
    });

    it('throws NotFoundException when the device does not exist', async () => {
      devicesRepository.findOne.mockResolvedValue(null);

      await expect(service.ingest('d1', sample)).rejects.toThrow(
        NotFoundException,
      );
      expect(rawModel.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the device has no cold room', async () => {
      devicesRepository.findOne.mockResolvedValue({
        ...activeDevice,
        coldRoom: null,
      });

      await expect(service.ingest('d1', sample)).rejects.toThrow(
        ConflictException,
      );
      expect(rawModel.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the device is decommissioned', async () => {
      devicesRepository.findOne.mockResolvedValue({
        ...activeDevice,
        status: DeviceStatus.DECOMMISSIONED,
      });

      await expect(service.ingest('d1', sample)).rejects.toThrow(
        ConflictException,
      );
      expect(rawModel.create).not.toHaveBeenCalled();
    });

    it('stores an in-range sample with the room snapshot', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      await expect(service.ingest('d1', sample)).resolves.toEqual({
        stored: true,
      });

      expect(rawModel.create).toHaveBeenCalledWith({
        deviceId: 'd1',
        coldRoomId: 'c1',
        ts: sample.ts,
        temperature: -18,
        doorOpen: false,
        sensorFault: false,
        outOfRange: false,
      });
      // -18 is within the recovered band [-19,-16] (tempMax=-15, hysteresis=1)
      // — see the "temperature alert wiring" tests for the boundary cases.
      expect(alertsService.resolveAuto).toHaveBeenCalledWith({
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        deviceId: 'd1',
        coldRoomId: 'c1',
        warehouseId: 'w1',
      });
      expect(alertsService.raise).not.toHaveBeenCalled();
    });

    it.each([
      ['above temp_max', -10],
      ['below temp_min', -25],
    ])('flags a sample %s as out of range', async (_label, temperature) => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      await service.ingest('d1', { ...sample, temperature });

      expect(rawModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature, outOfRange: true }),
      );
    });

    it('treats values exactly on the thresholds as in range', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      await service.ingest('d1', { ...sample, temperature: -15 });

      expect(rawModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ outOfRange: false }),
      );
      // In range, but not yet past the hysteresis band (-16) either — neither
      // side of the alert wiring fires for this edge.
      expect(alertsService.raise).not.toHaveBeenCalled();
      expect(alertsService.resolveAuto).not.toHaveBeenCalled();
    });

    it('stores null temperature and never flags out-of-range on a sensor fault', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      await service.ingest('d1', {
        ...sample,
        temperature: 99,
        sensorFault: true,
      });

      expect(rawModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: null,
          sensorFault: true,
          outOfRange: false,
        }),
      );
      // A fault reading is skipped entirely, not read as "recovered".
      expect(alertsService.raise).not.toHaveBeenCalled();
      expect(alertsService.resolveAuto).not.toHaveBeenCalled();
    });

    it.each([null, NaN, Infinity])(
      'records temperature %p without a fault flag as a sensor error',
      async (temperature) => {
        devicesRepository.findOne.mockResolvedValue(activeDevice);

        await service.ingest('d1', { ...sample, temperature });

        expect(rawModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: null,
            sensorFault: true,
            outOfRange: false,
          }),
        );
      },
    );

    it('returns stored: false for a duplicate (deviceId, ts)', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);
      rawModel.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );

      await expect(service.ingest('d1', sample)).resolves.toEqual({
        stored: false,
      });
    });

    it('rethrows any other write error', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);
      rawModel.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.ingest('d1', sample)).rejects.toThrow(
        'connection lost',
      );
    });

    it('does not evaluate the alert for a redelivered (duplicate) sample', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);
      rawModel.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );

      await service.ingest('d1', { ...sample, temperature: -10 }); // would be out of range

      expect(alertsService.raise).not.toHaveBeenCalled();
      expect(alertsService.resolveAuto).not.toHaveBeenCalled();
    });
  });

  describe('temperature alert wiring', () => {
    it('raises an alert with threshold/direction=high when above temp_max', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      await service.ingest('d1', {
        ...sample,
        temperature: -10,
        doorOpen: true,
      });

      expect(alertsService.raise).toHaveBeenCalledWith({
        coldRoomId: 'c1',
        deviceId: 'd1',
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        triggerValue: -10,
        threshold: -15,
        details: { direction: 'high', doorOpenAtTrigger: true },
      });
      expect(alertsService.resolveAuto).not.toHaveBeenCalled();
    });

    it('raises an alert with threshold/direction=low when below temp_min', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      await service.ingest('d1', {
        ...sample,
        temperature: -25,
        doorOpen: false,
      });

      expect(alertsService.raise).toHaveBeenCalledWith({
        coldRoomId: 'c1',
        deviceId: 'd1',
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        triggerValue: -25,
        threshold: -20,
        details: { direction: 'low', doorOpenAtTrigger: false },
      });
      expect(alertsService.resolveAuto).not.toHaveBeenCalled();
    });

    it('auto-resolves once temperature is back inside the hysteresis band', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      // Exactly on the recovery boundary (tempMax - hysteresis = -16).
      await service.ingest('d1', { ...sample, temperature: -16 });

      expect(alertsService.resolveAuto).toHaveBeenCalledWith({
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        deviceId: 'd1',
        coldRoomId: 'c1',
        warehouseId: 'w1',
      });
      expect(alertsService.raise).not.toHaveBeenCalled();
    });

    it('does neither while in range but still inside the hysteresis gap', async () => {
      devicesRepository.findOne.mockResolvedValue(activeDevice);

      // In range (-20..-15) but warmer than the -16 recovery boundary.
      await service.ingest('d1', { ...sample, temperature: -15.5 });

      expect(alertsService.raise).not.toHaveBeenCalled();
      expect(alertsService.resolveAuto).not.toHaveBeenCalled();
    });
  });

  describe('findHourly', () => {
    it('throws NotFoundException when the device does not exist', async () => {
      devicesRepository.existsBy.mockResolvedValue(false);

      await expect(service.findHourly('d1', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(hourlyModel.find).not.toHaveBeenCalled();
    });

    it('rejects from >= to', async () => {
      devicesRepository.existsBy.mockResolvedValue(true);

      await expect(
        service.findHourly('d1', {
          from: '2026-09-21T10:00:00.000Z',
          to: '2026-09-21T10:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a range longer than the maximum', async () => {
      devicesRepository.existsBy.mockResolvedValue(true);

      await expect(
        service.findHourly('d1', {
          from: '2024-01-01T00:00:00.000Z',
          to: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('aligns from down to the hour and returns buckets oldest first', async () => {
      devicesRepository.existsBy.mockResolvedValue(true);
      const buckets = [{ deviceId: 'd1' }];
      const chain = createQueryChain(buckets);
      hourlyModel.find.mockReturnValue(chain);

      const result = await service.findHourly('d1', {
        from: '2026-09-21T10:30:00.000Z',
        to: '2026-09-21T14:00:00.000Z',
      });

      expect(result).toBe(buckets);
      expect(hourlyModel.find).toHaveBeenCalledWith({
        deviceId: 'd1',
        hourBucket: {
          $gte: new Date('2026-09-21T10:00:00.000Z'),
          $lt: new Date('2026-09-21T14:00:00.000Z'),
        },
      });
      expect(chain.sort).toHaveBeenCalledWith({ hourBucket: 1 });
      expect(chain.lean).toHaveBeenCalled();
    });

    it('defaults to the last 24 hours', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
      try {
        devicesRepository.existsBy.mockResolvedValue(true);
        hourlyModel.find.mockReturnValue(createQueryChain());

        await service.findHourly('d1', {});

        expect(hourlyModel.find).toHaveBeenCalledWith({
          deviceId: 'd1',
          hourBucket: {
            $gte: new Date('2026-09-20T12:00:00.000Z'),
            $lt: new Date('2026-09-21T12:00:00.000Z'),
          },
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('findRaw', () => {
    const range = {
      from: '2026-09-21T10:00:00.000Z',
      to: '2026-09-21T11:00:00.000Z',
    };

    it('throws NotFoundException when the device does not exist', async () => {
      devicesRepository.existsBy.mockResolvedValue(false);

      await expect(service.findRaw('d1', range)).rejects.toThrow(
        NotFoundException,
      );
      expect(rawModel.find).not.toHaveBeenCalled();
    });

    it('rejects a range longer than the maximum', async () => {
      devicesRepository.existsBy.mockResolvedValue(true);

      await expect(
        service.findRaw('d1', {
          from: '2026-09-21T00:00:00.000Z',
          to: '2026-09-21T12:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('queries the window oldest first with the default limit', async () => {
      devicesRepository.existsBy.mockResolvedValue(true);
      const chain = createQueryChain();
      rawModel.find.mockReturnValue(chain);

      await service.findRaw('d1', range);

      expect(rawModel.find).toHaveBeenCalledWith({
        deviceId: 'd1',
        ts: {
          $gte: new Date('2026-09-21T10:00:00.000Z'),
          $lt: new Date('2026-09-21T11:00:00.000Z'),
        },
      });
      expect(chain.sort).toHaveBeenCalledWith({ ts: 1 });
      expect(chain.limit).toHaveBeenCalledWith(1000);
    });

    it('honours an explicit limit', async () => {
      devicesRepository.existsBy.mockResolvedValue(true);
      const chain = createQueryChain();
      rawModel.find.mockReturnValue(chain);

      await service.findRaw('d1', { ...range, limit: 50 });

      expect(chain.limit).toHaveBeenCalledWith(50);
    });
  });
});
