import { HttpException } from '@nestjs/common';

import {
  applyReplies,
  changesSinceSent,
  ChefReply,
  ClientMark,
  keptMarks,
  listStatus,
  marksApply,
  mergeMarks,
  quietSince,
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

const UNMARKED = { alreadyHave: false, comment: null, haveQty: null, chefReply: null };

describe('withMarks', () => {
  const marks: ClientMark[] = [
    { name: 'ail', unit: 'Gousse', qty: 6, alreadyHave: true, comment: null },
    { name: 'Sel fin', unit: 'g', qty: 5, alreadyHave: false, comment: 'Gros sel' },
  ];

  it('puts a mark on the same ingredient and unit, whatever the case', () => {
    const [ail] = withMarks([garlic], marks);

    expect(ail).toEqual({ ...garlic, ...UNMARKED, alreadyHave: true, toBuyQty: 0 });
  });

  it('drops a mark whose quantity changed since: the client answered another amount', () => {
    const [sel] = withMarks([salt], marks);

    expect(sel).toEqual({ ...salt, ...UNMARKED, toBuyQty: 10 });
  });

  it('leaves unmarked lines unmarked', () => {
    expect(withMarks([garlic], [])).toEqual([{ ...garlic, ...UNMARKED, toBuyQty: 6 }]);
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
      {
        name: 'Ail',
        unit: 'gousse',
        qty: 6,
        alreadyHave: true,
        comment: null,
        haveQty: null,
      },
    ]);
  });

  it('keeps a comment on a line the client does not have', () => {
    expect(
      toMarks(
        [salt],
        [{ name: 'Sel fin', unit: 'g', alreadyHave: false, comment: ' Gros sel ' }],
      ),
    ).toEqual([
      {
        name: 'Sel fin',
        unit: 'g',
        qty: 10,
        alreadyHave: false,
        comment: 'Gros sel',
        haveQty: null,
      },
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

const VALIDATION = expect.objectContaining({
  response: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
});

const flour = { name: 'Farine', qty: 400, unit: 'g', aisle: 'epicerie' };
const pepper = { name: 'Poivre', qty: 0, unit: 'to_taste', aisle: 'epicerie' };
const oil = {
  name: 'Huile',
  qty: 20,
  unit: 'ml',
  aisle: 'epicerie',
  providedByChef: true,
};

describe('« J’en ai une partie » (haveQty)', () => {
  const mark = (haveQty: number) => ({
    name: 'Farine',
    unit: 'g',
    alreadyHave: false,
    haveQty,
  });

  it('keeps a part below the quantity as a partial mark, and buys the rest', () => {
    const marks = toMarks([flour], [mark(150)]);

    expect(marks).toEqual([
      {
        name: 'Farine',
        unit: 'g',
        qty: 400,
        alreadyHave: false,
        comment: null,
        haveQty: 150,
      },
    ]);
    expect(withMarks([flour], marks)[0]).toMatchObject({
      alreadyHave: false,
      haveQty: 150,
      toBuyQty: 250,
    });
  });

  it('reads the whole quantity or more as « I already have it »', () => {
    const [stored] = toMarks([flour], [mark(400)]);

    expect(stored).toMatchObject({ alreadyHave: true, haveQty: null });
    expect(withMarks([flour], [stored])[0]).toMatchObject({ toBuyQty: 0 });
  });

  it('rounds what is left to buy like the list rounds its quantities', () => {
    const marks = toMarks([flour], [mark(123)]);

    // 277 g → rounded to 5 g above 100 g (Recettes §4.12).
    expect(withMarks([flour], marks)[0].toBuyQty).toBe(275);
  });

  it.each([
    ['zero', [flour], mark(0)],
    ['a negative amount', [flour], mark(-5)],
    [
      'a line without quantity',
      [pepper],
      { ...mark(5), name: 'Poivre', unit: 'to_taste' },
    ],
  ])('refuses %s', (_, lines, input) => {
    expect(() => toMarks(lines, [input])).toThrow(VALIDATION);
  });

  it('drops the partial mark when the line asks for another quantity', () => {
    const marks = toMarks([flour], [mark(150)]);

    expect(withMarks([{ ...flour, qty: 600 }], marks)[0]).toMatchObject({
      haveQty: null,
      toBuyQty: 600,
    });
  });
});

describe('« Fourni par le batch cooker » (providedByChef)', () => {
  it('refuses a mark on a line the batch cooker brings', () => {
    expect(() =>
      toMarks([oil], [{ name: 'Huile', unit: 'ml', alreadyHave: true }]),
    ).toThrow(VALIDATION);
  });
});

describe('mergeMarks (a tick saved at once)', () => {
  const current: ClientMark[] = toMarks(
    [garlic, salt],
    [
      { name: 'Ail', unit: 'gousse', alreadyHave: true },
      { name: 'Sel fin', unit: 'g', alreadyHave: false, comment: 'Gros sel' },
    ],
  );

  it('upserts the lines sent and keeps the others', () => {
    const merged = mergeMarks([garlic, salt], current, [
      { name: 'Sel fin', unit: 'g', alreadyHave: true },
    ]);

    expect(merged).toEqual([
      expect.objectContaining({ name: 'Ail', alreadyHave: true }),
      expect.objectContaining({ name: 'Sel fin', alreadyHave: true, comment: null }),
    ]);
  });

  it('removes a mark sent back empty', () => {
    const merged = mergeMarks([garlic, salt], current, [
      { name: 'ail', unit: 'gousse', alreadyHave: false },
    ]);

    expect(merged.map((m) => m.name)).toEqual(['Sel fin']);
  });

  it('is idempotent', () => {
    const input = [{ name: 'Ail', unit: 'gousse', alreadyHave: true }];
    const once = mergeMarks([garlic, salt], current, input);

    expect(mergeMarks([garlic, salt], once, input)).toEqual(once);
  });

  it('checks the lines like a final list does', () => {
    expect(() =>
      mergeMarks([garlic], [], [{ name: 'Persil', unit: 'botte', alreadyHave: true }]),
    ).toThrow(VALIDATION);
  });
});

describe('keptMarks (a new version is sent)', () => {
  const marks = toMarks(
    [garlic, salt, flour],
    [
      { name: 'Ail', unit: 'gousse', alreadyHave: true },
      { name: 'Sel fin', unit: 'g', alreadyHave: false, comment: 'Gros sel' },
      { name: 'Farine', unit: 'g', alreadyHave: true },
    ],
  );

  it('keeps the marks of unchanged lines, drops those of changed, gone or brought lines', () => {
    const kept = keptMarks(
      [garlic, { ...salt, qty: 20 }, { ...flour, providedByChef: true }],
      marks,
    );

    expect(kept.map((m) => m.name)).toEqual(['Ail']);
  });
});

describe('changesSinceSent (pendingChanges)', () => {
  const sent = [
    { ...garlic, edited: false },
    { ...salt, edited: false },
  ];

  it('is empty when the live list is the one sent', () => {
    expect(changesSinceSent(sent, sent)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('reports an added, a removed and a changed line', () => {
    const live = [
      { ...garlic, qty: 8, edited: true },
      { ...flour, edited: true },
    ];

    expect(changesSinceSent(sent, live)).toEqual({
      added: [live[1]],
      removed: [sent[1]],
      changed: [{ before: sent[0], after: live[0] }],
    });
  });

  it('counts a line newly brought by the batch cooker as a change', () => {
    const live = [{ ...garlic, edited: true, providedByChef: true }, sent[1]];

    expect(changesSinceSent(sent, live).changed).toHaveLength(1);
  });
});

describe('quietSince (one bell per quiet spell)', () => {
  const now = at('2026-11-03T08:00:00.000Z');

  it.each([
    [true, null],
    [true, at('2026-11-03T07:45:00.000Z')],
    [false, at('2026-11-03T07:50:00.000Z')],
  ])('%s after %s', (expected, last) => {
    expect(quietSince(last, now)).toBe(expected);
  });
});

describe('chef replies to a comment', () => {
  const NOW = at('2026-11-03T08:00:00.000Z');
  const marks = toMarks(
    [garlic, salt],
    [{ name: 'Sel fin', unit: 'g', alreadyHave: false, comment: 'Bio si possible' }],
  );

  it('answers the comment as it is, and shows the reply while it stays the same', () => {
    const replies = applyReplies(
      [garlic, salt],
      marks,
      [],
      [{ name: 'sel fin', unit: 'g', reply: ' OK ' }],
      NOW,
    );

    expect(replies).toEqual([
      {
        name: 'Sel fin',
        unit: 'g',
        reply: 'OK',
        answersComment: 'Bio si possible',
        repliedAt: NOW,
      },
    ]);
    expect(withMarks([salt], marks, replies)[0].chefReply).toEqual({
      reply: 'OK',
      repliedAt: NOW,
    });
  });

  it('hides a reply once the client changes their comment', () => {
    const replies: ChefReply[] = [
      {
        name: 'Sel fin',
        unit: 'g',
        reply: 'OK',
        answersComment: 'Bio si possible',
        repliedAt: NOW,
      },
    ];
    const changed = toMarks(
      [salt],
      [{ name: 'Sel fin', unit: 'g', alreadyHave: false, comment: 'Gros sel plutôt' }],
    );

    expect(withMarks([salt], changed, replies)[0].chefReply).toBeNull();
  });

  it('clears a reply with null', () => {
    const first = applyReplies(
      [salt],
      marks,
      [],
      [{ name: 'Sel fin', unit: 'g', reply: 'OK' }],
      NOW,
    );

    expect(
      applyReplies(
        [salt],
        marks,
        first,
        [{ name: 'Sel fin', unit: 'g', reply: null }],
        NOW,
      ),
    ).toEqual([]);
  });

  it.each([
    ['a line not sent', { name: 'Persil', unit: 'botte', reply: 'OK' }],
    ['a line without comment', { name: 'Ail', unit: 'gousse', reply: 'OK' }],
  ])('refuses %s', (_, input) => {
    expect(() => applyReplies([garlic, salt], marks, [], [input], NOW)).toThrow(
      VALIDATION,
    );
  });
});
