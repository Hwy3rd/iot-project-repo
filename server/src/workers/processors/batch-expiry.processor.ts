import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';

// Connection + schedule only for now — sweep logic (marking expired
// batches) lands in a follow-up change.
@Injectable()
@Processor(QUEUE_NAMES.BATCH_MAINTENANCE)
export class BatchExpiryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BatchExpiryProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.BATCH_MAINTENANCE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    // Fixed scheduler id = upsert, not duplicate, on every restart.
    await this.queue.upsertJobScheduler(
      'batch-expiry-sweep',
      { every: 60 * 60 * 1000 }, // every hour
      { name: 'sweep' },
    );
  }

  process(job: Job): Promise<void> {
    // TODO: sweep IN_STOCK batches past expiryDate and mark them EXPIRED.
    this.logger.debug(
      `Received job ${job.name} (${job.id}) — not yet implemented`,
    );
    return Promise.resolve();
  }
}
