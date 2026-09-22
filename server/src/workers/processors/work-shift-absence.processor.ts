import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';

// Connection + schedule only for now — sweep logic (marking absent
// work shifts) lands in a follow-up change.
@Injectable()
@Processor(QUEUE_NAMES.WORK_SHIFT_MAINTENANCE)
export class WorkShiftAbsenceProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(WorkShiftAbsenceProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.WORK_SHIFT_MAINTENANCE)
    private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    // Fixed scheduler id = upsert, not duplicate, on every restart.
    await this.queue.upsertJobScheduler(
      'work-shift-absence-sweep',
      { every: 15 * 60 * 1000 }, // every 15 minutes
      { name: 'sweep' },
    );
  }

  process(job: Job): Promise<void> {
    // TODO: sweep SCHEDULED work shifts past their grace period and mark them ABSENT.
    this.logger.debug(
      `Received job ${job.name} (${job.id}) — not yet implemented`,
    );
    return Promise.resolve();
  }
}
