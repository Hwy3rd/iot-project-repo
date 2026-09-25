import { hoursOverlap } from './shift-hours';

const h = (startTime: string, endTime: string) => ({ startTime, endTime });

describe('hoursOverlap', () => {
  it.each([
    [h('06:00', '14:00'), h('14:00', '22:00'), false],
    [h('06:00', '14:00'), h('13:59', '15:00'), true],
    [h('22:00', '06:00'), h('06:00', '14:00'), false],
    [h('22:00', '06:00'), h('05:00', '07:00'), true],
    [h('22:00', '06:00'), h('23:00', '23:30'), true],
    [h('22:00', '06:00'), h('20:00', '02:00'), true],
    [h('00:00', '06:00'), h('18:00', '00:00'), false],
  ])('%j vs %j → %s', (a, b, expected) => {
    expect(hoursOverlap(a, b)).toBe(expected);
    expect(hoursOverlap(b, a)).toBe(expected);
  });
});
