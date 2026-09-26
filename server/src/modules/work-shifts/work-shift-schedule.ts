import {
  CHECK_IN_EARLY_MINUTES,
  SHIFT_END_GRACE_MINUTES,
  SHIFT_UTC_OFFSET_MINUTES,
} from '../../libs/constants/work-shift.constant';
import type { Shift } from '../shifts/entities/shift.entity';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface ShiftSchedule {
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}

export interface OpenShift extends ShiftSchedule {
  shift: Shift;
  // Business-timezone date the shift starts on (YYYY-MM-DD). A night shift
  // worked at 01:00 belongs to the previous day.
  workDate: string;
}

// The template's start/end wall-clock times placed on workDate in the
// business timezone. If endTime <= startTime the shift crosses midnight
// (e.g. 22:00-06:00), so the end lands on the following day.
export function scheduleFor(workDate: string, shift: Shift): ShiftSchedule {
  const scheduledStartAt = wallClockToInstant(workDate, shift.startTime);
  let scheduledEndAt = wallClockToInstant(workDate, shift.endTime);
  if (scheduledEndAt <= scheduledStartAt) {
    scheduledEndAt = new Date(scheduledEndAt.getTime() + DAY_MS);
  }
  return { scheduledStartAt, scheduledEndAt };
}

// The shift a Staff member checking in at `now` is asking for: one whose
// window [start - CHECK_IN_EARLY_MINUTES, end) contains `now`. When windows
// overlap (the early window of the morning shift vs. the last minutes of the
// night shift), the one starting latest wins — someone checking in then is
// arriving for the upcoming shift, not the one about to end.
export function openShiftAt(shifts: Shift[], now: Date): OpenShift | null {
  let best: OpenShift | null = null;
  for (const dayOffset of [-1, 0, 1]) {
    const workDate = businessDate(now, dayOffset);
    for (const shift of shifts) {
      const schedule = scheduleFor(workDate, shift);
      const opensAt =
        schedule.scheduledStartAt.getTime() -
        CHECK_IN_EARLY_MINUTES * MINUTE_MS;
      if (now.getTime() < opensAt || now >= schedule.scheduledEndAt) continue;
      if (!best || schedule.scheduledStartAt > best.scheduledStartAt) {
        best = { shift, workDate, ...schedule };
      }
    }
  }
  return best;
}

// Whole minutes a check-in came after the shift's scheduled start; 0 when on
// time or early (check-in opens CHECK_IN_EARLY_MINUTES before), null when
// there's no check-in.
export function lateMinutes(
  checkInAt: Date | string | null | undefined,
  scheduledStartAt: Date | string,
): number | null {
  if (!checkInAt) return null;
  const late =
    new Date(checkInAt).getTime() - new Date(scheduledStartAt).getTime();
  return Math.max(0, Math.floor(late / MINUTE_MS));
}

// An approved shift gives Staff their permissions until it ends plus
// SHIFT_END_GRACE_MINUTES: it is active while scheduledEndAt > this cutoff.
export const activeShiftCutoff = (now: Date): Date =>
  new Date(now.getTime() - SHIFT_END_GRACE_MINUTES * MINUTE_MS);

// Calendar date (YYYY-MM-DD) in the business timezone, `dayOffset` days
// from the one `instant` falls on.
export function businessDate(instant: Date, dayOffset = 0): string {
  const shifted =
    instant.getTime() +
    SHIFT_UTC_OFFSET_MINUTES * MINUTE_MS +
    dayOffset * DAY_MS;
  return new Date(shifted).toISOString().slice(0, 10);
}

function wallClockToInstant(date: string, time: string): Date {
  const [hours, minutes, seconds = 0] = time.split(':').map(Number);
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  return new Date(
    utcMidnight +
      ((hours * 60 + minutes - SHIFT_UTC_OFFSET_MINUTES) * 60 + seconds) * 1000,
  );
}
