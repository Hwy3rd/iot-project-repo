import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import {
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import {
  COMMAND_MAX_ATTEMPTS,
  COMMAND_RETRY_INTERVAL_MS,
  CommandStatus,
  OPEN_COMMAND_STATUSES,
} from '../../libs/constants/command.constant';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { CommandDispatcherService } from '../../modules/commands/command-dispatcher.service';
import { Command } from '../../modules/commands/entities/command.entity';

// Upper bound per run so one sweep never holds the queue for long after a
// broker outage; the rest go out on the next tick.
const SWEEP_BATCH = 100;

// Drives every open command to a final state without anyone having to:
//   - past expires_at → expired (no publish after that, the device would
//     refuse it anyway);
//   - pending (the first publish never reached the broker) → published;
//   - sent but unacked for COMMAND_RETRY_INTERVAL_MS → re-published, up to
//     COMMAND_MAX_ATTEMPTS in total, then left to expire.
// Re-publishing is safe because the firmware dedupes by command id and just
// re-sends its ack for one it already ran.
@Injectable()
@Processor(QUEUE_NAMES.COMMAND_DISPATCH)
export class CommandRetryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CommandRetryProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.COMMAND_DISPATCH)
    private readonly queue: Queue,
    @InjectRepository(Command)
    private readonly commandsRepository: Repository<Command>,
    private readonly dispatcher: CommandDispatcherService,
  ) {
    super();
  }

  async onModuleInit() {
    // Fixed scheduler id = upsert, not duplicate, on every restart. Half
    // the retry interval, so a due command waits at most that much extra.
    // ~17k runs a day: unlike the hourly sweeps, finished jobs must not pile
    // up in Redis (keep a few failed ones to look at).
    await this.queue.upsertJobScheduler(
      'command-retry-sweep',
      { every: COMMAND_RETRY_INTERVAL_MS / 2 },
      {
        name: 'sweep',
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  async process(job: Job): Promise<void> {
    const { expired, published } = await this.sweep(new Date());
    if (expired || published) {
      this.logger.debug(
        `Job ${job.id}: expired ${expired}, published ${published} command(s)`,
      );
    }
  }

  async sweep(now: Date): Promise<{ expired: number; published: number }> {
    const expired = await this.commandsRepository.update(
      {
        status: In([...OPEN_COMMAND_STATUSES]),
        expiresAt: LessThanOrEqual(now),
      },
      { status: CommandStatus.EXPIRED },
    );

    const retryBefore = new Date(now.getTime() - COMMAND_RETRY_INTERVAL_MS);
    const due = await this.commandsRepository.find({
      where: [
        {
          status: CommandStatus.PENDING,
          expiresAt: MoreThan(now),
          attempts: LessThan(COMMAND_MAX_ATTEMPTS),
        },
        {
          status: CommandStatus.SENT,
          expiresAt: MoreThan(now),
          attempts: LessThan(COMMAND_MAX_ATTEMPTS),
          sentAt: LessThanOrEqual(retryBefore),
        },
        // Defensive: `sent` always has sent_at, but a row without one
        // would otherwise never be retried.
        {
          status: CommandStatus.SENT,
          expiresAt: MoreThan(now),
          attempts: LessThan(COMMAND_MAX_ATTEMPTS),
          sentAt: IsNull(),
        },
      ],
      order: { createdAt: 'ASC', id: 'ASC' },
      take: SWEEP_BATCH,
    });

    // Sequential and oldest first, so commands reach a device in the order
    // they were issued.
    let published = 0;
    for (const command of due) {
      if (await this.dispatcher.dispatch(command, now)) published++;
    }
    return { expired: expired.affected ?? 0, published };
  }
}
