import { parisMinute } from '../../../common/paris-time';
import {
  DayException,
  Span,
  WeeklySlot,
  isBookable,
  startTimes,
  subtract,
  workingSpans,
} from './availability.rules';

const at = (iso: string) => new Date(iso);
const span = (start: string, end: string): Span => ({
  start: at(start).getTime(),
  end: at(end).getTime(),
});
const iso = (spans: Span[]) =>
  spans.map((s) => [new Date(s.start).toISOString(), new Date(s.end).toISOString()]);

// Sundays, 9:00 to 12:00 Paris time.
const SUNDAY_MORNINGS: WeeklySlot[] = [{ weekday: 6, startMinute: 540, endMinute: 720 }];

describe('Paris wall time', () => {
  it('stays right in the hours around both clock changes', () => {
    // 01:30 is still winter time on 29 March, still summer time on 25 October.
    expect(parisMinute(at('2026-03-29'), 90).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    expect(parisMinute(at('2026-10-25'), 90).toISOString()).toBe(
      '2026-10-24T23:30:00.000Z',
    );
  });
});

describe('workingSpans', () => {
  it('reads the template in Paris time across the spring change', () => {
    const spans = workingSpans(
      SUNDAY_MORNINGS,
      [],
      at('2026-03-21T00:00:00Z'),
      at('2026-03-30T00:00:00Z'),
    );
    expect(iso(spans)).toEqual([
      ['2026-03-22T08:00:00.000Z', '2026-03-22T11:00:00.000Z'], // UTC+1
      ['2026-03-29T07:00:00.000Z', '2026-03-29T10:00:00.000Z'], // UTC+2
    ]);
  });

  it('and across the autumn change', () => {
    const spans = workingSpans(
      SUNDAY_MORNINGS,
      [],
      at('2026-10-17T00:00:00Z'),
      at('2026-10-26T00:00:00Z'),
    );
    expect(iso(spans)).toEqual([
      ['2026-10-18T07:00:00.000Z', '2026-10-18T10:00:00.000Z'], // UTC+2
      ['2026-10-25T08:00:00.000Z', '2026-10-25T11:00:00.000Z'], // UTC+1
    ]);
  });

  it('drops a closed day and adds an extra range', () => {
    const exceptions: DayException[] = [
      { date: at('2026-03-22'), kind: 'closed', startMinute: null, endMinute: null },
      { date: at('2026-03-24'), kind: 'extra', startMinute: 840, endMinute: 900 },
    ];
    const spans = workingSpans(
      SUNDAY_MORNINGS,
      exceptions,
      at('2026-03-21T00:00:00Z'),
      at('2026-03-25T00:00:00Z'),
    );
    expect(iso(spans)).toEqual([
      ['2026-03-24T13:00:00.000Z', '2026-03-24T14:00:00.000Z'],
    ]);
  });

  it('clips to the window asked', () => {
    const spans = workingSpans(
      SUNDAY_MORNINGS,
      [],
      at('2026-03-22T09:00:00Z'),
      at('2026-03-22T10:00:00Z'),
    );
    expect(iso(spans)).toEqual([
      ['2026-03-22T09:00:00.000Z', '2026-03-22T10:00:00.000Z'],
    ]);
  });
});

describe('subtract and startTimes', () => {
  const morning = span('2026-03-22T08:00:00Z', '2026-03-22T11:00:00Z');

  it('takes busy time out', () => {
    const free = subtract(
      [morning],
      [span('2026-03-22T09:00:00Z', '2026-03-22T09:45:00Z')],
    );
    expect(iso(free)).toEqual([
      ['2026-03-22T08:00:00.000Z', '2026-03-22T09:00:00.000Z'],
      ['2026-03-22T09:45:00.000Z', '2026-03-22T11:00:00.000Z'],
    ]);
  });

  it('offers start times on the 30-minute grid that fit whole', () => {
    const free = subtract(
      [morning],
      [span('2026-03-22T09:00:00Z', '2026-03-22T09:45:00Z')],
    );
    const starts = startTimes(free, 60 * 60 * 1000).map((d) => d.toISOString());
    expect(starts).toEqual([
      '2026-03-22T08:00:00.000Z',
      '2026-03-22T10:00:00.000Z', // 09:45 rounds up to 10:00, which ends exactly at 11:00
    ]);
  });
});

describe('isBookable', () => {
  const working = [span('2026-03-22T08:00:00Z', '2026-03-22T11:00:00Z')];

  it('accepts a time inside working hours with nothing in the way', () => {
    expect(
      isBookable(working, [], span('2026-03-22T08:00:00Z', '2026-03-22T11:00:00Z')),
    ).toBe(true);
  });

  it('refuses a time outside working hours', () => {
    expect(
      isBookable(working, [], span('2026-03-22T10:30:00Z', '2026-03-22T11:30:00Z')),
    ).toBe(false);
  });

  it('refuses a time that overlaps something busy', () => {
    const busy = [span('2026-03-22T09:30:00Z', '2026-03-22T10:00:00Z')];
    expect(
      isBookable(working, busy, span('2026-03-22T09:00:00Z', '2026-03-22T10:00:00Z')),
    ).toBe(false);
  });
});
