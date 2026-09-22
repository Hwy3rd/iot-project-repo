import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { TelemetryRollupService } from '../../modules/telemetry/telemetry-rollup.service';

// Pass `{ hour: '<ISO date>' }` as job data to (re)build one specific hour,
// e.g. to backfill after raw data was fixed. Without it the job rolls up the
// most recent closed hours.
export interface TelemetryRollupJobData {
  hour?: string;
}

@Injectable()
@Processor(QUEUE_NAMES.TELEMETRY_ROLLUP)
export class TelemetryRollupProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(TelemetryRollupProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TELEMETRY_ROLLUP) private readonly queue: Queue,
    private readonly rollupService: TelemetryRollupService,
  ) {
    super();
  }

  async onModuleInit() {
    // Fixed scheduler id = upsert, not duplicate, on every restart. Runs at
    // minute 5 so samples that arrive slightly late for the hour that just
    // closed are already in.
    await this.queue.upsertJobScheduler(
      'telemetry-hourly-rollup',
      { pattern: '5 * * * *', tz: 'UTC' },
      { name: 'rollup' },
    );
  }

  async process(job: Job<TelemetryRollupJobData>): Promise<void> {
    if (job.data?.hour) {
      const hour = new Date(job.data.hour);
      if (Number.isNaN(hour.getTime())) {
        throw new Error(`Invalid hour in job data: ${job.data.hour}`);
      }
      await this.rollupService.rollupHour(hour);
      this.logger.log(`Rolled up telemetry for ${hour.toISOString()}`);
      return;
    }

    await this.rollupService.rollupRecentHours();
    this.logger.log('Rolled up recent telemetry hours');
  }
}
