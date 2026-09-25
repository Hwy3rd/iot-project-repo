import type { Shift } from '../shifts/entities/shift.entity';
import {
  activeShiftCutoff,
  businessDate,
  openShiftAt,
  scheduleFor,
} from './work-shift-schedule';

// Template times are UTC+7 wall-clock times: 06:00 there is 23:00Z the day before.
const shift = (id: string, startTime: string, endTime: string) =>
  ({ id, name: id, startTime, endTime }) as Shift;
const morning = shift('m', '06:00:00', '14:00:00');
const afternoon = shift('a', '14:00:00', '22:00:00');
const night = shift('n', '22:00:00', '06:00:00');
const all = [morning, afternoon, night];
const at = (iso: string) => new Date(iso);

describe('scheduleFor', () => {
  it('places the template times on the date in the business timezone', () => {
    expect(scheduleFor('2026-09-25', morning)).toEqual({
      scheduledStartAt: at('2026-09-24T23:00:00Z'),
      scheduledEndAt: at('2026-09-25T07:00:00Z'),
    });
  });

  it('rolls the end to the next day for an overnight shift', () => {
    expect(scheduleFor('2026-09-25', night)).toEqual({
      scheduledStartAt: at('2026-09-25T15:00:00Z'),
      scheduledEndAt: at('2026-09-25T23:00:00Z'),
    });
  });

  it('accepts HH:mm times', () => {
    expect(
      scheduleFor('2026-09-25', shift('x', '06:30', '07:00')).scheduledStartAt,
    ).toEqual(at('2026-09-24T23:30:00Z'));
  });
});

describe('businessDate', () => {
  it('is the UTC+7 calendar date', () => {
    expect(businessDate(at('2026-09-24T17:00:00Z'))).toBe('2026-09-25');
    expect(businessDate(at('2026-09-24T16:59:59Z'))).toBe('2026-09-24');
    expect(businessDate(at('2026-09-24T17:00:00Z'), -1)).toBe('2026-09-24');
  });
});

describe('openShiftAt', () => {
  it('finds the shift in progress', () => {
    // 10:00 local.
    expect(openShiftAt(all, at('2026-09-25T03:00:00Z'))).toMatchObject({
      shift: morning,
      workDate: '2026-09-25',
    });
  });

  it('opens 15 minutes before the start, not earlier', () => {
    // 13:45 and 13:44 local — the afternoon shift starts at 14:00.
    expect(openShiftAt([afternoon], at('2026-09-25T06:45:00Z'))?.shift).toBe(
      afternoon,
    );
    expect(openShiftAt([afternoon], at('2026-09-25T06:44:59Z'))).toBeNull();
  });

  it('is closed from the end of the shift', () => {
    // 22:00 local, afternoon ends.
    expect(openShiftAt([afternoon], at('2026-09-25T15:00:00Z'))).toBeNull();
  });

  it('prefers the upcoming shift when the early window overlaps the previous one', () => {
    // 13:50 local: the morning shift is still on, the afternoon one opens.
    expect(openShiftAt(all, at('2026-09-25T06:50:00Z'))?.shift).toBe(afternoon);
  });

  it('dates an after-midnight night shift on the day it started', () => {
    // 01:00 local on the 26th.
    expect(openShiftAt(all, at('2026-09-25T18:00:00Z'))).toEqual({
      shift: night,
      workDate: '2026-09-25',
      scheduledStartAt: at('2026-09-25T15:00:00Z'),
      scheduledEndAt: at('2026-09-25T23:00:00Z'),
    });
  });

  it('finds nothing between shifts', () => {
    // 15:00 local with only a morning shift.
    expect(openShiftAt([morning], at('2026-09-25T08:00:00Z'))).toBeNull();
  });
});

describe('activeShiftCutoff', () => {
  it('is 5 minutes before now', () => {
    expect(activeShiftCutoff(at('2026-09-25T07:05:00Z'))).toEqual(
      at('2026-09-25T07:00:00Z'),
    );
  });
});
