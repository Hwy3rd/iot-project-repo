import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';
import { BatchStatus } from '../../libs/constants/batch.constant';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { Batch } from '../../modules/batches/entities/batch.entity';
import { businessDate } from '../../modules/work-shifts/work-shift-schedule';

// Marks IN_STOCK batches past their expiry date as EXPIRED. A batch is
// expired from the day after expiryDate (business timezone), matching the
// `expiryDate < today` rule the cold room inventory already applies.
@Injectable()
@Processor(QUEUE_NAMES.BATCH_MAINTENANCE)
export class BatchExpiryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BatchExpiryProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.BATCH_MAINTENANCE) private readonly queue: Queue,
    @InjectRepository(Batch)
    private readonly batchesRepository: Repository<Batch>,
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

  async process(job: Job): Promise<void> {
    const expired = await this.sweep();
    this.logger.debug(
      `Job ${job.name} (${job.id}): marked ${expired} batch(es) expired`,
    );
  }

  // Public so it can be tested without going through the queue.
  async sweep(now = new Date()): Promise<number> {
    const result = await this.batchesRepository.update(
      {
        status: BatchStatus.IN_STOCK,
        expiryDate: LessThan(businessDate(now)),
      },
      { status: BatchStatus.EXPIRED },
    );
    return result.affected ?? 0;
  }
}
