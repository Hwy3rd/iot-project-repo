const DAY_MINUTES = 24 * 60;

interface Hours {
  startTime: string;
  endTime: string;
}

// Minutes since midnight of an HH:mm or HH:mm:ss time (seconds ignored).
export const minuteOfDay = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// The template's hours as [start, end) minute ranges within one day: an
// overnight shift (end <= start) is split at midnight into two.
function ranges({ startTime, endTime }: Hours): [number, number][] {
  const start = minuteOfDay(startTime);
  const end = minuteOfDay(endTime);
  if (end > start) return [[start, end]];
  return [
    [start, DAY_MINUTES],
    [0, end],
  ].filter(([from, to]) => to > from) as [number, number][];
}

// Whether two templates share any minute of the day. Touching ends
// (one ends at 14:00, the next starts at 14:00) don't overlap.
export function hoursOverlap(a: Hours, b: Hours): boolean {
  return ranges(a).some(([aFrom, aTo]) =>
    ranges(b).some(([bFrom, bTo]) => aFrom < bTo && bFrom < aTo),
  );
}
