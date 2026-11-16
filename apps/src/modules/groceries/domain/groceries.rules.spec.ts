import {
  captureAmount,
  cancelIsLate,
  cancelRefusal,
  contestRefusal,
  deadlineOutcome,
  depositDeadlines,
  groceriesApply,
  holdExpiry,
  instantPayoutFee,
  lockAt,
  mandateRules,
  noticeRefusal,
  readMandateRules,
  receiptsRefusal,
  refundDue,
  safetyCaptureDue,
  settles,
  StoredLine,
} from './groceries.rules';

const H = 60 * 60 * 1000;
const STARTS = new Date('2026-12-10T10:00:00.000Z');
const RULES = mandateRules(10_000);
const code = (error: unknown) =>
  (error as { getResponse(): { code: string } } | null)?.getResponse().code ?? null;

describe('mandate rules', () => {
  it('copies the 2.0 clauses, and reads a stored version clause by clause', () => {
    expect(RULES).toEqual({
      budgetCents: 10_000,
      lockHours: 48,
      receiptsWithinHours: 24,
      captureAfterHours: 24,
      contestHours: 48,
    });
    expect(readMandateRules({ contestHours: 72, lockHours: -1 }, 8_000)).toMatchObject({
      budgetCents: 8_000,
      contestHours: 72,
      lockHours: 48,
    });
  });

  it('applies only when the batch cooker shops under an accepted mandate', () => {
    const base = {
      shoppingByClient: false,
      deboursMandateAcceptedAt: new Date(),
      serviceOffer: { shoppingIncluded: true },
    };
    expect(groceriesApply(base)).toBe(true);
    expect(groceriesApply({ ...base, shoppingByClient: true })).toBe(false);
    expect(groceriesApply({ ...base, deboursMandateAcceptedAt: null })).toBe(false);
    expect(groceriesApply({ ...base, serviceOffer: { shoppingIncluded: false } })).toBe(
      false,
    );
  });
});

describe('the hold', () => {
  it('is placed at the lock, 48 hours before, and lives 4 days 18 hours at most', () => {
    expect(lockAt(STARTS, RULES)).toEqual(new Date(STARTS.getTime() - 48 * H));
    const placed = new Date('2026-12-08T10:00:00.000Z');
    expect(holdExpiry(placed)).toEqual(new Date(placed.getTime() + 114 * H));
    expect(holdExpiry(placed, placed.getTime() / 1000 + 3 * 24 * 3600)).toEqual(
      new Date(placed.getTime() + 72 * H),
    );
  });

  it('is captured early 6 hours before it expires', () => {
    const expires = new Date('2026-12-12T10:00:00.000Z');
    expect(safetyCaptureDue(expires, new Date(expires.getTime() - 7 * H))).toBe(false);
    expect(safetyCaptureDue(expires, new Date(expires.getTime() - 6 * H))).toBe(true);
    expect(safetyCaptureDue(null, new Date())).toBe(false);
  });
});

describe('the message before the groceries', () => {
  const now = new Date(STARTS.getTime() - 40 * H);
  const ok = {
    status: 'hold_placed' as const,
    now,
    startsAt: STARTS,
    rules: RULES,
    shoppingAt: new Date(STARTS.getTime() - 20 * H),
    cancelDeadline: new Date(now.getTime() + 3 * H),
    minNoticeMinutes: 120,
  };

  it('is sent once the hold is placed, with a deadline the console allows', () => {
    expect(noticeRefusal(ok)).toBeNull();
    expect(code(noticeRefusal({ ...ok, status: 'card_saved' }))).toBe(
      'GROCERY_HOLD_MISSING',
    );
    expect(code(noticeRefusal({ ...ok, status: 'notice_sent' }))).toBe(
      'GROCERY_NOTICE_SENT',
    );
    expect(
      code(
        noticeRefusal({
          ...ok,
          cancelDeadline: new Date(now.getTime() + 90 * 60 * 1000),
        }),
      ),
    ).toBe('GROCERY_DEADLINE_TOO_SOON');
  });

  it('refuses groceries before the lock, and a deadline after them', () => {
    expect(
      code(noticeRefusal({ ...ok, shoppingAt: new Date(STARTS.getTime() - 50 * H) })),
    ).toBe('GROCERY_RUN_TOO_EARLY');
    expect(
      code(
        noticeRefusal({ ...ok, cancelDeadline: new Date(ok.shoppingAt.getTime() + H) }),
      ),
    ).toBe('GROCERY_DEADLINE_INVALID');
  });
});

describe('the cancel deadline', () => {
  const deadline = new Date('2026-12-09T08:00:00.000Z');
  const base = {
    status: 'notice_sent' as const,
    cancelDeadline: deadline,
    emailDeliveredAt: new Date(deadline.getTime() - 5 * H),
    emailBouncedAt: null,
    silenceConfirms: true,
    now: deadline,
  };

  it('waits for the deadline', () => {
    expect(
      deadlineOutcome({ ...base, now: new Date(deadline.getTime() - 1) }),
    ).toBeNull();
  });

  it('lets the silence confirm only when the console allows it and the e-mail was delivered', () => {
    expect(deadlineOutcome(base)).toBe('confirmed');
    expect(deadlineOutcome({ ...base, silenceConfirms: false })).toBe('awaiting_client');
    expect(deadlineOutcome({ ...base, emailDeliveredAt: null })).toBe('awaiting_client');
    expect(deadlineOutcome({ ...base, emailBouncedAt: deadline })).toBe(
      'awaiting_client',
    );
    expect(
      deadlineOutcome({ ...base, emailDeliveredAt: new Date(deadline.getTime() + 1) }),
    ).toBe('awaiting_client');
  });

  it('lets the client cancel until the groceries are done; late after the lock', () => {
    expect(cancelRefusal('confirmed')).toBeNull();
    expect(code(cancelRefusal('receipts_submitted'))).toBe('GROCERY_CANCEL_CLOSED');
    expect(cancelIsLate(new Date(STARTS.getTime() - 49 * H), STARTS, RULES)).toBe(false);
    expect(cancelIsLate(new Date(STARTS.getTime() - 47 * H), STARTS, RULES)).toBe(true);
  });
});

describe('the receipts', () => {
  const now = new Date(STARTS.getTime() - 10 * H);
  const ok = {
    status: 'confirmed' as const,
    now,
    startsAt: STARTS,
    rules: RULES,
    receipts: [{ purchasedAt: new Date(now.getTime() - 2 * H) }],
    lines: [
      { label: 'Poulet fermier', amountCents: 2_400, receipt: 0 },
      { label: 'Herbes du marché', amountCents: 300, receipt: null },
    ],
  };

  it('are deposited once, after the client confirmed', () => {
    expect(receiptsRefusal(ok)).toBeNull();
    expect(code(receiptsRefusal({ ...ok, status: 'notice_sent' }))).toBe(
      'GROCERY_NOT_CONFIRMED',
    );
    expect(code(receiptsRefusal({ ...ok, status: 'captured' }))).toBe(
      'GROCERY_RECEIPTS_SENT',
    );
  });

  it('refuses a total above the Budget: the gap stays with the chef', () => {
    const above = { ...ok, lines: [{ label: 'Tout', amountCents: 10_001, receipt: 0 }] };
    expect(code(receiptsRefusal(above))).toBe('GROCERIES_ABOVE_MANDATE');
    const at = { ...ok, lines: [{ label: 'Tout', amountCents: 10_000, receipt: 0 }] };
    expect(receiptsRefusal(at)).toBeNull();
  });

  it('refuses a purchase before the lock, or deposited more than 24 hours later', () => {
    const early = {
      ...ok,
      receipts: [{ purchasedAt: new Date(STARTS.getTime() - 49 * H) }],
    };
    expect(code(receiptsRefusal(early))).toBe('GROCERY_RUN_TOO_EARLY');
    const late = {
      ...ok,
      now: new Date(STARTS.getTime() + 20 * H),
      receipts: [{ purchasedAt: new Date(STARTS.getTime() - 5 * H) }],
    };
    expect(code(receiptsRefusal(late))).toBe('GROCERY_RECEIPTS_LATE');
  });

  it('opens the capture at 24 h and the contests for 48 h', () => {
    const at = new Date('2026-12-09T12:00:00.000Z');
    expect(depositDeadlines(at, RULES)).toEqual({
      captureDueAt: new Date(at.getTime() + 24 * H),
      contestClosesAt: new Date(at.getTime() + 48 * H),
    });
  });
});

describe('the capture', () => {
  const line = (over: Partial<StoredLine>): StoredLine => ({
    id: 'l',
    amountCents: 1_000,
    receiptId: 'r1',
    clientApprovedAt: null,
    contestedAt: null,
    decision: null,
    refundedCents: 0,
    ...over,
  });

  it('takes the exact total of the lines with a receipt, contested ones included', () => {
    expect(
      captureAmount(
        [
          line({}),
          line({ amountCents: 500, contestedAt: new Date() }),
          line({ amountCents: 300, receiptId: null }),
          line({ amountCents: 200, receiptId: null, clientApprovedAt: new Date() }),
          line({ amountCents: 700, decision: 'upheld' }),
        ],
        10_000,
      ),
    ).toBe(1_700);
  });

  it('never takes more than the Budget', () => {
    expect(captureAmount([line({ amountCents: 12_000 })], 10_000)).toBe(10_000);
  });

  it('refunds what is left of an upheld line', () => {
    expect(refundDue({ amountCents: 1_000, refundedCents: 400 })).toBe(600);
  });

  it('settles once the contests are closed and decided', () => {
    const closes = new Date('2026-12-11T12:00:00.000Z');
    const after = new Date(closes.getTime() + 1);
    expect(settles(closes, [line({})], new Date(closes.getTime() - 1))).toBe(false);
    expect(settles(closes, [line({ contestedAt: new Date() })], after)).toBe(false);
    expect(
      settles(closes, [line({ contestedAt: new Date(), decision: 'rejected' })], after),
    ).toBe(true);
  });

  it('charges the chef the instant payout fee, with its minimum', () => {
    const rules = { instantPayoutFeeBps: 150, instantPayoutFeeMinCents: 50 };
    expect(instantPayoutFee(10_000, rules)).toBe(150);
    expect(instantPayoutFee(1_000, rules)).toBe(50);
    expect(instantPayoutFee(30, rules)).toBe(30);
  });

  it('refuses a contest after 48 h, and a second one', () => {
    const closes = new Date('2026-12-11T12:00:00.000Z');
    expect(
      contestRefusal({ contestedAt: null }, closes, new Date(closes.getTime() - 1)),
    ).toBeNull();
    expect(code(contestRefusal({ contestedAt: null }, closes, closes))).toBe(
      'GROCERY_CONTEST_CLOSED',
    );
    expect(
      code(
        contestRefusal(
          { contestedAt: new Date() },
          closes,
          new Date(closes.getTime() - 1),
        ),
      ),
    ).toBe('GROCERY_LINE_CONTESTED');
  });
});
