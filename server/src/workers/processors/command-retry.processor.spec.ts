import { In, IsNull, LessThan, LessThanOrEqual, MoreThan } from 'typeorm';
import {
  COMMAND_MAX_ATTEMPTS,
  CommandStatus,
} from '../../libs/constants/command.constant';
import { CommandRetryProcessor } from './command-retry.processor';

describe('CommandRetryProcessor', () => {
  const queue = { upsertJobScheduler: jest.fn() };
  const repo = { update: jest.fn(), find: jest.fn() };
  const dispatcher = { dispatch: jest.fn() };
  const processor = new CommandRetryProcessor(
    queue as never,
    repo as never,
    dispatcher as never,
  );
  const now = new Date('2026-10-03T08:00:30Z');

  beforeEach(() => {
    jest.clearAllMocks();
    repo.update.mockResolvedValue({ affected: 0 });
    repo.find.mockResolvedValue([]);
  });

  it('schedules the sweep every 5 seconds', async () => {
    await processor.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'command-retry-sweep',
      { every: 5000 },
      {
        name: 'sweep',
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  });

  it('expires open commands past their deadline', async () => {
    repo.update.mockResolvedValue({ affected: 3 });

    await expect(processor.sweep(now)).resolves.toEqual({
      expired: 3,
      published: 0,
    });
    expect(repo.update).toHaveBeenCalledWith(
      {
        status: In([CommandStatus.PENDING, CommandStatus.SENT]),
        expiresAt: LessThanOrEqual(now),
      },
      { status: CommandStatus.EXPIRED },
    );
  });

  it('publishes pending commands and re-publishes stale sent ones, oldest first', async () => {
    const due = [{ id: 'a' }, { id: 'b' }];
    repo.find.mockResolvedValue(due);
    dispatcher.dispatch
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(processor.sweep(now)).resolves.toEqual({
      expired: 0,
      published: 1,
    });

    const live = {
      expiresAt: MoreThan(now),
      attempts: LessThan(COMMAND_MAX_ATTEMPTS),
    };
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { status: CommandStatus.PENDING, ...live },
          {
            status: CommandStatus.SENT,
            ...live,
            sentAt: LessThanOrEqual(new Date('2026-10-03T08:00:20Z')),
          },
          { status: CommandStatus.SENT, ...live, sentAt: IsNull() },
        ],
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    );
    expect(dispatcher.dispatch.mock.calls).toEqual([
      [due[0], now],
      [due[1], now],
    ]);
  });
});
