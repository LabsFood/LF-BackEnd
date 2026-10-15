import { commissionForPayment, type CommissionPolicyDb } from './commission-policy';
import { assertPayable, commissionBlockApplies, paymentPhase } from './payment-rules';

const NOW = new Date('2026-10-13T12:00:00Z');
const before = new Date('2026-10-13T11:00:00Z');
const after = new Date('2026-10-14T09:00:00Z');

describe('paymentPhase', () => {
  it('a confirmed prestation is paid after it took place', () => {
    expect(paymentPhase({ status: 'confirmed', endsAt: after }, NOW)).toBe('not_due');
    expect(paymentPhase({ status: 'confirmed', endsAt: before }, NOW)).toBe('due');
  });

  it('a pending booking is paid at once: paying is what confirms it', () => {
    expect(paymentPhase({ status: 'pending', endsAt: after }, NOW)).toBe('due');
  });

  it('a cancelled booking is never paid', () => {
    expect(paymentPhase({ status: 'cancelled', endsAt: before }, NOW)).toBe('cancelled');
  });

  it('says why a booking cannot be paid', () => {
    expect(() => assertPayable({ status: 'confirmed', endsAt: after }, NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'BOOKING_NOT_DUE' }),
      }),
    );
    expect(() => assertPayable({ status: 'cancelled' }, NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'BOOKING_CANCELLED' }),
      }),
    );
    expect(() => assertPayable({ status: 'completed' }, NOW)).not.toThrow();
    // FLOW-03 §3: a dispute blocks payment, even once the prestation is over.
    expect(() => assertPayable({ status: 'disputed', endsAt: before }, NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'BOOKING_DISPUTED' }),
      }),
    );
  });

  it('a cook’s unpaid commission only blocks payments that open new work', () => {
    expect(commissionBlockApplies({ status: 'pending' })).toBe(true);
    expect(commissionBlockApplies({ status: 'confirmed' })).toBe(false);
  });
});

describe('commissionForPayment', () => {
  const RATES = { rateBps: 1500, vatRateBps: 2000 };
  const db = (offer: object | null, setting: unknown = null) =>
    ({
      quote: {
        findUnique: jest.fn().mockResolvedValue(offer ? { offers: [offer] } : null),
      },
      platformSetting: {
        findUnique: jest
          .fn()
          .mockResolvedValue(setting === null ? null : { value: setting }),
      },
    }) as unknown as CommissionPolicyDb;

  // Net 170 € priced at 15 %: the client pays 200 €, Lab's Food keeps 30 €.
  const OFFER = { netCents: 17_000, clientPriceCents: 20_000, commissionBps: 1500 };

  it('keeps the deal of the accepted offer: the cook gets their net', async () => {
    const commission = await commissionForPayment(db(OFFER), { id: 'b1' }, 20_000, RATES);

    expect(commission.amountTtcCents).toBe(3_000);
    expect(20_000 - commission.amountTtcCents).toBe(OFFER.netCents);
    // The VAT is inside what is kept, split out for the invoice.
    expect(commission.amountHtCents + commission.amountVatCents).toBe(3_000);
    expect(commission.amountHtCents).toBe(2_500);
  });

  it('ignores a rate changed since the offer', async () => {
    const commission = await commissionForPayment(
      db(OFFER, 4000),
      { id: 'b1' },
      20_000,
      RATES,
    );

    expect(commission.rateBps).toBe(1500);
    expect(commission.amountTtcCents).toBe(3_000);
  });

  it('takes its share of a partial payment', async () => {
    const commission = await commissionForPayment(db(OFFER), { id: 'b1' }, 5_000, RATES);

    expect(commission.amountTtcCents).toBe(750);
  });

  it('charges the admin’s rate on a booking with no offer', async () => {
    const commission = await commissionForPayment(
      db(null, 1000),
      { id: 'b1' },
      10_000,
      RATES,
    );

    expect(commission.rateBps).toBe(1000);
    expect(commission.amountHtCents).toBe(1_000);
  });

  it('falls back to the environment rate while none was saved', async () => {
    const commission = await commissionForPayment(db(null), { id: 'b1' }, 10_000, RATES);

    expect(commission.rateBps).toBe(1500);
  });
});
