import {
  DAY_MS,
  parisMinute,
  parisToday,
  weekdayOf,
  ymd,
} from '../../../common/paris-time';

/**
 * When a batch cooker can take a prestation, as pure functions: their weekly
 * template and dated exceptions (minutes since midnight, Paris time, the model of
 * batchcooking-web's agenda), minus whatever already holds their time.
 */

/** A stretch of time, in epoch milliseconds, end excluded. */
export interface Span {
  start: number;
  end: number;
}

export interface WeeklySlot {
  /** 0 = Monday. */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface DayException {
  /** A calendar date: UTC midnight. */
  date: Date;
  kind: 'extra' | 'closed';
  startMinute: number | null;
  endMinute: number | null;
}

/** Start times are offered on this grid, 30 minutes by default. */
export const SLOT_STEP_MS = 30 * 60 * 1000;

/** The furthest a free-slot query may look at once. */
export const MAX_WINDOW_DAYS = 31;

/**
 * The working time between `from` and `to`. A `closed` exception takes out that
 * day's template; an `extra` one adds its range, closed day or not.
 */
export function workingSpans(
  template: WeeklySlot[],
  exceptions: DayException[],
  from: Date,
  to: Date,
): Span[] {
  const spans: Span[] = [];
  for (let day = parisToday(from); parisMinute(day, 0) < to;) {
    const key = ymd(day);
    const today = exceptions.filter((e) => ymd(e.date) === key);
    const closed = today.some((e) => e.kind === 'closed');
    const ranges = [
      ...(closed ? [] : template.filter((slot) => slot.weekday === weekdayOf(day))),
      ...today.filter((e) => e.kind === 'extra'),
    ];
    for (const range of ranges) {
      spans.push({
        start: parisMinute(day, range.startMinute!).getTime(),
        end: parisMinute(day, range.endMinute!).getTime(),
      });
    }
    day = new Date(day.getTime() + DAY_MS);
  }
  return merge(spans)
    .map((span) => ({
      start: Math.max(span.start, from.getTime()),
      end: Math.min(span.end, to.getTime()),
    }))
    .filter((span) => span.start < span.end);
}

/** Sorted, with overlapping and touching spans joined. */
export function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

/** `spans` with every `busy` stretch taken out. */
export function subtract(spans: Span[], busy: Span[]): Span[] {
  let free = merge(spans);
  for (const block of merge(busy)) {
    free = free.flatMap((span) =>
      block.end <= span.start || block.start >= span.end
        ? [span]
        : [
            { start: span.start, end: block.start },
            { start: block.end, end: span.end },
          ].filter((part) => part.start < part.end),
    );
  }
  return free;
}

/** Start times on the grid from which `durationMs` fits whole in a free span. */
export function startTimes(
  free: Span[],
  durationMs: number,
  stepMs = SLOT_STEP_MS,
): Date[] {
  const out: Date[] = [];
  for (const span of free) {
    for (
      let t = Math.ceil(span.start / stepMs) * stepMs;
      t + durationMs <= span.end;
      t += stepMs
    ) {
      out.push(new Date(t));
    }
  }
  return out;
}

/** Whether `[start, end)` lies inside one working span and overlaps nothing busy. */
export function isBookable(working: Span[], busy: Span[], wanted: Span): boolean {
  return subtract(working, busy).some(
    (span) => span.start <= wanted.start && wanted.end <= span.end,
  );
}

/** Whether two ranges with the same `key` (a weekday, a date) overlap. */
export function hasOverlap(
  ranges: { key: string; start: number; end: number }[],
): boolean {
  const sorted = [...ranges].sort((a, b) =>
    a.key === b.key ? a.start - b.start : a.key.localeCompare(b.key),
  );
  return sorted.some(
    (range, i) =>
      i > 0 && sorted[i - 1].key === range.key && range.start < sorted[i - 1].end,
  );
}
