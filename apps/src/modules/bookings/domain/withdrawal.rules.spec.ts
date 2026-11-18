import {
  isFrenchPublicHoliday,
  withdrawalDeadline,
  withdrawalFor,
  type WithdrawableBooking,
} from './withdrawal.rules';

/** A Paris wall-clock instant in winter (UTC+1). */
const paris = (iso: string) => new Date(`${iso}+01:00`);

describe('isFrenchPublicHoliday', () => {
  it.each([
    '2026-01-01',
    '2026-04-06', // Easter Monday 2026
    '2026-05-01',
    '2026-05-08',
    '2026-05-14', // Ascension 2026
    '2026-05-25', // Whit Monday 2026
    '2026-07-14',
    '2026-08-15',
    '2026-11-01',
    '2026-11-11',
    '2026-12-25',
    '2027-03-29', // Easter Monday 2027
  ])('%s is a public holiday', (day) => {
    expect(isFrenchPublicHoliday(new Date(`${day}T00:00:00Z`))).toBe(true);
  });

  it.each(['2026-11-12', '2026-04-05', '2026-12-26'])('%s is not', (day) => {
    expect(isFrenchPublicHoliday(new Date(`${day}T00:00:00Z`))).toBe(false);
  });
});

describe('withdrawalDeadline', () => {
  it('ends at midnight, Paris time, fourteen days after the day of conclusion', () => {
    // Wednesday 25 November → Wednesday 9 December, 23:59:59.999 Paris.
    expect(withdrawalDeadline(paris('2026-11-25T10:00:00'))).toEqual(
      new Date('2026-12-09T22:59:59.999Z'),
    );
  });

  it('counts the Paris day, not the UTC one', () => {
    // 23:30 UTC on the 25th is already the 26th in Paris.
    expect(withdrawalDeadline(new Date('2026-11-25T23:30:00Z'))).toEqual(
      new Date('2026-12-10T22:59:59.999Z'),
    );
  });

  it('moves past a weekend to the next working day', () => {
    // Saturday 28 November → Saturday 12 December → Monday 14 December.
    expect(withdrawalDeadline(paris('2026-11-28T12:00:00'))).toEqual(
      new Date('2026-12-14T22:59:59.999Z'),
    );
  });

  it('moves past a public holiday', () => {
    // 28 October → Wednesday 11 November (Armistice) → Thursday 12 November.
    expect(withdrawalDeadline(paris('2026-10-28T12:00:00'))).toEqual(
      new Date('2026-11-12T22:59:59.999Z'),
    );
  });

  it('moves past a weekend followed by a holiday', () => {
    // Saturday 1 May 2027 → Saturday 15 May → Sunday → Whit Monday 17 → Tuesday 18.
    expect(withdrawalDeadline(new Date('2027-05-01T10:00:00+02:00'))).toEqual(
      new Date('2027-05-18T21:59:59.999Z'),
    );
  });
});

describe('withdrawalFor', () => {
  const concludedAt = paris('2026-11-25T10:00:00');
  const NOW = paris('2026-11-27T09:00:00');
  const base: WithdrawableBooking = {
    status: 'confirmed',
    concludedAt,
    withdrawnAt: null,
    earlyExecutionRequestedAt: null,
    amountTtc: 12_000,
    priceCents: 10_000,
  };

  it('refunds everything before the prestation has started', () => {
    expect(withdrawalFor(base, 12_000, NOW)).toEqual({
      availableUntil: new Date('2026-12-09T22:59:59.999Z'),
      refusal: null,
      dueCents: 0,
      refundCents: 12_000,
    });
  });

  it('is not open on a booking not yet concluded', () => {
    expect(
      withdrawalFor({ ...base, status: 'pending', concludedAt: null }, 0, NOW),
    ).toEqual({
      availableUntil: null,
      refusal: 'WITHDRAWAL_NOT_CONCLUDED',
      dueCents: null,
      refundCents: null,
    });
  });

  it('is sent once', () => {
    const r = withdrawalFor({ ...base, withdrawnAt: NOW, status: 'cancelled' }, 0, NOW);
    expect(r.refusal).toBe('WITHDRAWAL_ALREADY_SENT');
  });

  it('is closed on a cancelled booking', () => {
    expect(withdrawalFor({ ...base, status: 'cancelled' }, 0, NOW).refusal).toBe(
      'BOOKING_CANCELLED',
    );
  });

  it('closes after the deadline', () => {
    const late = new Date('2026-12-09T23:00:00Z');
    expect(withdrawalFor(base, 0, late).refusal).toBe('WITHDRAWAL_PERIOD_OVER');
    expect(withdrawalFor(base, 0, new Date('2026-12-09T22:59:00Z')).refusal).toBeNull();
  });

  it('owes 20 % of the price once the shopping is done, when early execution was asked', () => {
    const r = withdrawalFor(
      { ...base, status: 'shopping', earlyExecutionRequestedAt: concludedAt },
      12_000,
      NOW,
    );
    expect(r).toMatchObject({ refusal: null, dueCents: 2_400, refundCents: 9_600 });
  });

  it('owes nothing when the client never asked to start early (L.221-25)', () => {
    const r = withdrawalFor({ ...base, status: 'cooking' }, 12_000, NOW);
    expect(r).toMatchObject({ refusal: null, dueCents: 0, refundCents: 12_000 });
  });

  it('leaves the share to an admin while cooking or in dispute', () => {
    for (const status of ['cooking', 'disputed'] as const) {
      const r = withdrawalFor(
        { ...base, status, earlyExecutionRequestedAt: concludedAt },
        12_000,
        NOW,
      );
      expect(r).toMatchObject({ refusal: null, dueCents: null, refundCents: null });
    }
  });

  it('is lost once fully performed at the client’s express request (L.221-28 1°)', () => {
    for (const status of ['delivered', 'completed'] as const) {
      const r = withdrawalFor(
        { ...base, status, earlyExecutionRequestedAt: concludedAt },
        12_000,
        NOW,
      );
      expect(r.refusal).toBe('WITHDRAWAL_EXECUTED');
    }
  });

  it('stays open on a performed prestation the client never asked to start early', () => {
    const r = withdrawalFor({ ...base, status: 'completed' }, 12_000, NOW);
    expect(r).toMatchObject({ refusal: null, dueCents: 0, refundCents: 12_000 });
  });

  it('never refunds below zero, and falls back to the price without a TTC amount', () => {
    const r = withdrawalFor(
      {
        ...base,
        status: 'shopping',
        earlyExecutionRequestedAt: concludedAt,
        amountTtc: null,
      },
      0,
      NOW,
    );
    expect(r).toMatchObject({ dueCents: 2_000, refundCents: 0 });
  });
});
