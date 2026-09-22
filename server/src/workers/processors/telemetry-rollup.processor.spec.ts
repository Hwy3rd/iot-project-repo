import { Job, Queue } from 'bullmq';
import { TelemetryRollupService } from '../../modules/telemetry/telemetry-rollup.service';
import {
  TelemetryRollupJobData,
  TelemetryRollupProcessor,
} from './telemetry-rollup.processor';

describe('TelemetryRollupProcessor', () => {
  let processor: TelemetryRollupProcessor;
  const queue = { upsertJobScheduler: jest.fn() };
  const rollupService = {
    rollupHour: jest.fn(),
    rollupRecentHours: jest.fn(),
  };

  const jobWith = (data: TelemetryRollupJobData) =>
    ({ data }) as Job<TelemetryRollupJobData>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new TelemetryRollupProcessor(
      queue as unknown as Queue,
      rollupService as unknown as TelemetryRollupService,
    );
  });

  it('registers an hourly UTC schedule under a fixed id on startup', async () => {
    await processor.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'telemetry-hourly-rollup',
      { pattern: '5 * * * *', tz: 'UTC' },
      { name: 'rollup' },
    );
  });

  it('rolls up the recent closed hours when the job has no hour', async () => {
    await processor.process(jobWith({}));

    expect(rollupService.rollupRecentHours).toHaveBeenCalledTimes(1);
    expect(rollupService.rollupHour).not.toHaveBeenCalled();
  });

  it('rebuilds only the requested hour when job data carries one', async () => {
    await processor.process(jobWith({ hour: '2026-09-20T08:00:00.000Z' }));

    expect(rollupService.rollupHour).toHaveBeenCalledWith(
      new Date('2026-09-20T08:00:00.000Z'),
    );
    expect(rollupService.rollupRecentHours).not.toHaveBeenCalled();
  });

  it('fails the job when the requested hour is not a valid date', async () => {
    await expect(processor.process(jobWith({ hour: 'nope' }))).rejects.toThrow(
      'Invalid hour',
    );

    expect(rollupService.rollupHour).not.toHaveBeenCalled();
  });
});
