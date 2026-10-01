import { LessThan } from 'typeorm';
import { BatchStatus } from '../../libs/constants/batch.constant';
import { BatchExpiryProcessor } from './batch-expiry.processor';

describe('BatchExpiryProcessor', () => {
  const queue = { upsertJobScheduler: jest.fn() };
  const repo = { update: jest.fn() };
  const processor = new BatchExpiryProcessor(queue as never, repo as never);

  beforeEach(() => jest.clearAllMocks());

  it('schedules an hourly sweep', async () => {
    await processor.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'batch-expiry-sweep',
      { every: 3600000 },
      { name: 'sweep' },
    );
  });

  it('marks in-stock batches past expiry as expired (business date)', async () => {
    repo.update.mockResolvedValue({ affected: 3 });

    // 18:00Z is already the next day (00:00) in UTC+7.
    await expect(
      processor.sweep(new Date('2026-09-25T18:00:00Z')),
    ).resolves.toBe(3);

    expect(repo.update).toHaveBeenCalledWith(
      { status: BatchStatus.IN_STOCK, expiryDate: LessThan('2026-09-26') },
      { status: BatchStatus.EXPIRED },
    );
  });
});
