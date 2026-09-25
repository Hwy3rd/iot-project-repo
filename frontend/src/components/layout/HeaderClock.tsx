import { dayjs } from "@/lib/format";
import { useNow } from "@/lib/useNow";

/**
 * Current time for the header — Staff work to shift hours, so it's always
 * in view, large and at a glance: HH:mm plus a short day/month. Its own
 * component so the tick re-renders only this, not the page.
 */
export function HeaderClock() {
  // Ticks every second so the minute flips on time.
  const now = dayjs(useNow(1000));
  return (
    <time
      dateTime={now.format("YYYY-MM-DDTHH:mm:ss")}
      className="flex items-baseline gap-1.5 px-2 tabular-nums"
      // Screen readers would announce every tick otherwise.
      aria-hidden="true"
    >
      <span className="text-2xl font-semibold tracking-tight">
        {now.format("HH:mm:ss")}
      </span>
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {now.format("DD/MM")}
      </span>
    </time>
  );
}
