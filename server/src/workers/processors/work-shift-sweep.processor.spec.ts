import { IsNull, LessThanOrEqual } from 'typeorm';
import { WorkShiftStatus } from '../../libs/constants/work-shift.constant';
import { WorkShiftSweepProcessor } from './work-shift-sweep.processor';

describe('WorkShiftSweepProcessor', () => {
  const queue = {
    removeJobScheduler: jest.fn(),
    upsertJobScheduler: jest.fn(),
  };
  const repo = { update: jest.fn(), find: jest.fn() };
  const processor = new WorkShiftSweepProcessor(queue as never, repo as never);
  const now = new Date('2026-09-25T07:10:00Z');

  beforeEach(() => jest.clearAllMocks());

  it('replaces the old absence scheduler', async () => {
    await processor.onModuleInit();

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      'work-shift-absence-sweep',
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'work-shift-sweep',
      { every: 300000 },
      { name: 'sweep' },
    );
  });

  it('expires unreviewed requests of ended shifts and checks out overdue ones', async () => {
    repo.update.mockResolvedValueOnce({ affected: 2 });
    repo.find.mockResolvedValue([
      { id: 'ws-1', scheduledEndAt: new Date('2026-09-25T07:00:00Z') },
    ]);

    await expect(processor.sweep(now)).resolves.toEqual({
      expired: 2,
      checkedOut: 1,
    });

    expect(repo.update).toHaveBeenNthCalledWith(
      1,
      { status: WorkShiftStatus.PENDING, scheduledEndAt: LessThanOrEqual(now) },
      { status: WorkShiftStatus.EXPIRED },
    );
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: WorkShiftStatus.APPROVED,
          checkOutAt: IsNull(),
          scheduledEndAt: LessThanOrEqual(new Date('2026-09-25T07:05:00Z')),
        },
      }),
    );
    // Checked out at the end of the grace period, not at sweep time.
    expect(repo.update).toHaveBeenNthCalledWith(2, 'ws-1', {
      checkOutAt: new Date('2026-09-25T07:05:00Z'),
    });
  });
});
