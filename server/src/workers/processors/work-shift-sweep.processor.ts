import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import {
  SHIFT_END_GRACE_MINUTES,
  WorkShiftStatus,
} from '../../libs/constants/work-shift.constant';
import { WorkShift } from '../../modules/work-shifts/entities/work-shift.entity';
import { activeShiftCutoff } from '../../modules/work-shifts/work-shift-schedule';

// Closes out work shifts whose time is over. Housekeeping only — permission
// checks already go by the clock (WarehouseAccessService), so a late or
// missed run never lets anyone work past their shift:
//   - pending requests nobody reviewed before the shift ended → expired;
//   - approved shifts never checked out (the Staff closed the tab instead
//     of logging out) → checked out at the end of the grace period.
@Injectable()
@Processor(QUEUE_NAMES.WORK_SHIFT_MAINTENANCE)
export class WorkShiftSweepProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(WorkShiftSweepProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.WORK_SHIFT_MAINTENANCE)
    private readonly queue: Queue,
    @InjectRepository(WorkShift)
    private readonly workShiftsRepository: Repository<WorkShift>,
  ) {
    super();
  }

  async onModuleInit() {
    // Scheduler of the absence sweep this replaced.
    await this.queue.removeJobScheduler('work-shift-absence-sweep');
    // Fixed scheduler id = upsert, not duplicate, on every restart.
    await this.queue.upsertJobScheduler(
      'work-shift-sweep',
      { every: 5 * 60 * 1000 },
      { name: 'sweep' },
    );
  }

  async process(job: Job): Promise<void> {
    const { expired, checkedOut } = await this.sweep(new Date());
    this.logger.debug(
      `Job ${job.id}: expired ${expired} request(s), checked out ${checkedOut} shift(s)`,
    );
  }

  async sweep(now: Date): Promise<{ expired: number; checkedOut: number }> {
    const expired = await this.workShiftsRepository.update(
      {
        status: WorkShiftStatus.PENDING,
        scheduledEndAt: LessThanOrEqual(now),
      },
      { status: WorkShiftStatus.EXPIRED },
    );

    const overdue = await this.workShiftsRepository.find({
      where: {
        status: WorkShiftStatus.APPROVED,
        checkOutAt: IsNull(),
        scheduledEndAt: LessThanOrEqual(activeShiftCutoff(now)),
      },
      select: { id: true, scheduledEndAt: true },
    });
    for (const shift of overdue) {
      await this.workShiftsRepository.update(shift.id, {
        checkOutAt: new Date(
          shift.scheduledEndAt.getTime() + SHIFT_END_GRACE_MINUTES * 60 * 1000,
        ),
      });
    }
    return { expired: expired.affected ?? 0, checkedOut: overdue.length };
  }
}
