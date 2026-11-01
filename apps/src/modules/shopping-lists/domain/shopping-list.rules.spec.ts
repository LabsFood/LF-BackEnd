import { HttpException } from '@nestjs/common';

import {
  ClientMark,
  listStatus,
  marksApply,
  shoppingDeadline,
  submitRefusal,
  toMarks,
  withMarks,
} from './shopping-list.rules';

const garlic = { name: 'Ail', qty: 6, unit: 'gousse', aisle: 'fruits-legumes' };
const salt = { name: 'Sel fin', qty: 10, unit: 'g', aisle: 'epicerie' };

const at = (iso: string) => new Date(iso);
const SENT = at('2026-11-02T09:00:00.000Z');
const DEADLINE = at('2026-11-04T11:00:00.000Z');
const BEFORE = at('2026-11-03T08:00:00.000Z');

const reason = (error: HttpException | null) =>
  (error?.getResponse() as { code?: string } | undefined)?.code;

describe('shoppingDeadline (§10.7: noon, Paris time, the day before)', () => {
  it.each([
    ['in winter (UTC+1)', '2026-11-05T09:00:00.000Z', '2026-11-04T11:00:00.000Z'],
    ['in summer (UTC+2)', '2026-07-10T08:00:00.000Z', '2026-07-09T10:00:00.000Z'],
    // 00:30 on the 5th in Paris is still the 4th in UTC: the Paris day counts.
    [
      'just after midnight in Paris',
      '2026-11-04T23:30:00.000Z',
      '2026-11-04T11:00:00.000Z',
    ],
    // The clocks go forward on Sunday 29 March 2026: that noon is already UTC+2.
    ['the day the clocks change', '2026-03-30T07:00:00.000Z', '2026-03-29T10:00:00.000Z'],
  ])('%s', (_, startsAt, deadline) => {
    expect(shoppingDeadline(at(startsAt))).toEqual(at(deadline));
  });
});

describe('listStatus', () => {
  it.each([
    ['preparing', { version: 0, sentAt: null, finalReceivedAt: null }, BEFORE],
    ['sent', { version: 1, sentAt: SENT, finalReceivedAt: null }, BEFORE],
    ['update_sent', { version: 2, sentAt: SENT, finalReceivedAt: null }, BEFORE],
    [
      'final_received',
      { version: 1, sentAt: SENT, finalReceivedAt: at('2026-11-02T18:00:00.000Z') },
      BEFORE,
    ],
    // Answered version 1, then the chef sent version 2: the answer is out of date.
    [
      'update_sent',
      { version: 2, sentAt: SENT, finalReceivedAt: at('2026-11-01T18:00:00.000Z') },
      BEFORE,
    ],
    ['frozen', { version: 1, sentAt: SENT, finalReceivedAt: null }, DEADLINE],
    ['frozen', { version: 0, sentAt: null, finalReceivedAt: null }, DEADLINE],
  ])('%s', (status, list, now) => {
    expect(listStatus(list, DEADLINE, now)).toBe(status);
  });
});

describe('marksApply: the client answered the list sent last', () => {
  it.each([
    [false, { version: 0, sentAt: null, finalReceivedAt: null }],
    [false, { version: 1, sentAt: SENT, finalReceivedAt: null }],
    [true, { version: 1, sentAt: SENT, finalReceivedAt: at('2026-11-02T18:00:00.000Z') }],
    [
      false,
      { version: 2, sentAt: SENT, finalReceivedAt: at('2026-11-01T18:00:00.000Z') },
    ],
  ])('%s', (expected, list) => {
    expect(marksApply(list)).toBe(expected);
  });
});

describe('withMarks', () => {
  const marks: ClientMark[] = [
    { name: 'ail', unit: 'Gousse', qty: 6, alreadyHave: true, comment: null },
    { name: 'Sel fin', unit: 'g', qty: 5, alreadyHave: false, comment: 'Gros sel' },
  ];

  it('puts a mark on the same ingredient and unit, whatever the case', () => {
    const [ail] = withMarks([garlic], marks);

    expect(ail).toEqual({ ...garlic, alreadyHave: true, comment: null });
  });

  it('drops a mark whose quantity changed since: the client answered another amount', () => {
    const [sel] = withMarks([salt], marks);

    expect(sel).toEqual({ ...salt, alreadyHave: false, comment: null });
  });

  it('leaves unmarked lines unmarked', () => {
    expect(withMarks([garlic], [])).toEqual([
      { ...garlic, alreadyHave: false, comment: null },
    ]);
  });
});

describe('toMarks', () => {
  it('takes the quantity from the list, trims the comment and drops empty marks', () => {
    expect(
      toMarks(
        [garlic, salt],
        [
          { name: 'Ail', unit: 'gousse', alreadyHave: true },
          { name: 'Sel fin', unit: 'g', alreadyHave: false, comment: '  ' },
        ],
      ),
    ).toEqual([
      { name: 'Ail', unit: 'gousse', qty: 6, alreadyHave: true, comment: null },
    ]);
  });

  it('keeps a comment on a line the client does not have', () => {
    expect(
      toMarks(
        [salt],
        [{ name: 'Sel fin', unit: 'g', alreadyHave: false, comment: ' Gros sel ' }],
      ),
    ).toEqual([
      { name: 'Sel fin', unit: 'g', qty: 10, alreadyHave: false, comment: 'Gros sel' },
    ]);
  });

  it('refuses a line that is not on the list', () => {
    expect(() =>
      toMarks([garlic], [{ name: 'Persil', unit: 'botte', alreadyHave: true }]),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      }),
    );
  });

  it('refuses the same line twice', () => {
    expect(() =>
      toMarks(
        [garlic],
        [
          { name: 'Ail', unit: 'gousse', alreadyHave: true },
          { name: 'ail', unit: 'gousse', alreadyHave: false, comment: 'Rose' },
        ],
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      }),
    );
  });
});

describe('submitRefusal', () => {
  const sent = { version: 2, sentAt: SENT, finalReceivedAt: null };

  it('accepts the version on screen, before the deadline', () => {
    expect(submitRefusal(sent, DEADLINE, BEFORE, 2)).toBeNull();
  });

  it.each([
    [
      'SHOPPING_LIST_NOT_SENT',
      { version: 0, sentAt: null, finalReceivedAt: null },
      BEFORE,
      0,
    ],
    ['SHOPPING_LIST_FROZEN', sent, DEADLINE, 2],
    ['SHOPPING_LIST_UPDATED', sent, BEFORE, 1],
  ])('%s', (code, list, now, seen) => {
    expect(reason(submitRefusal(list, DEADLINE, now, seen))).toBe(code);
  });
});
