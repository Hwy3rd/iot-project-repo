import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryRaw } from './schemas/telemetry-raw.schema';
import { TelemetryRollupService } from './telemetry-rollup.service';

type Stage = Record<string, Record<string, unknown>>;

describe('TelemetryRollupService', () => {
  let service: TelemetryRollupService;
  let rawModel: {
    aggregate: jest.Mock<{ exec: jest.Mock }, [Stage[]]>;
  };
  let exec: jest.Mock;

  const pipelineOf = (call = 0) => rawModel.aggregate.mock.calls[call][0];
  const stageNames = (pipeline: Stage[]) =>
    pipeline.map((stage) => Object.keys(stage)[0]);
  const stageOf = (pipeline: Stage[], name: string) =>
    pipeline.find((stage) => name in stage)?.[name];

  beforeEach(async () => {
    exec = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryRollupService,
        {
          provide: getModelToken(TelemetryRaw.name),
          useValue: { aggregate: jest.fn().mockReturnValue({ exec }) },
        },
      ],
    }).compile();

    service = module.get(TelemetryRollupService);
    rawModel = module.get(getModelToken(TelemetryRaw.name));
  });

  describe('rollupHour', () => {
    it('matches exactly one hour, aligned down to the hour boundary', async () => {
      await service.rollupHour(new Date('2026-09-21T10:37:12.000Z'));

      expect(stageOf(pipelineOf(), '$match')).toEqual({
        ts: {
          $gte: new Date('2026-09-21T10:00:00.000Z'),
          $lt: new Date('2026-09-21T11:00:00.000Z'),
        },
      });
    });

    it('groups per device and stamps the bucket with the hour start', async () => {
      await service.rollupHour(new Date('2026-09-21T10:00:00.000Z'));

      const group = stageOf(pipelineOf(), '$group');
      const project = stageOf(pipelineOf(), '$project');

      expect(group?._id).toBe('$deviceId');
      expect(project?._id).toBe(0);
      expect(project?.deviceId).toBe('$_id');
      expect(project?.hourBucket).toEqual({
        $literal: new Date('2026-09-21T10:00:00.000Z'),
      });
    });

    it('sorts by ts before grouping so the latest cold room wins', async () => {
      await service.rollupHour(new Date('2026-09-21T10:00:00.000Z'));

      const stages = stageNames(pipelineOf());

      expect(stages.indexOf('$sort')).toBeGreaterThan(-1);
      expect(stages.indexOf('$sort')).toBeLessThan(stages.indexOf('$group'));
    });

    it('merges into telemetry_hourly by replacing the existing bucket', async () => {
      await service.rollupHour(new Date('2026-09-21T10:00:00.000Z'));

      const pipeline = pipelineOf();
      expect(pipeline[pipeline.length - 1]).toEqual({
        $merge: {
          into: 'telemetry_hourly',
          on: ['deviceId', 'hourBucket'],
          whenMatched: 'replace',
          whenNotMatched: 'insert',
        },
      });
      expect(exec).toHaveBeenCalledTimes(1);
    });

    it('propagates aggregation errors so the job fails and retries', async () => {
      exec.mockRejectedValue(new Error('mongo down'));

      await expect(
        service.rollupHour(new Date('2026-09-21T10:00:00.000Z')),
      ).rejects.toThrow('mongo down');
    });
  });

  describe('rollupRecentHours', () => {
    it('rolls up the last 3 closed hours oldest first, skipping the current one', async () => {
      await service.rollupRecentHours(new Date('2026-09-21T10:05:00.000Z'));

      const starts = rawModel.aggregate.mock.calls.map(
        ([pipeline]) => stageOf(pipeline, '$match')?.ts,
      );
      expect(starts).toEqual([
        {
          $gte: new Date('2026-09-21T07:00:00.000Z'),
          $lt: new Date('2026-09-21T08:00:00.000Z'),
        },
        {
          $gte: new Date('2026-09-21T08:00:00.000Z'),
          $lt: new Date('2026-09-21T09:00:00.000Z'),
        },
        {
          $gte: new Date('2026-09-21T09:00:00.000Z'),
          $lt: new Date('2026-09-21T10:00:00.000Z'),
        },
      ]);
    });
  });
});
