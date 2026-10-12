import { computeCommission } from './commission.util';

describe('computeCommission', () => {
  const rates = { rateBps: 1500, vatRateBps: 2000 };

  it('applies the rate then VAT on top of the rounded commission', () => {
    expect(computeCommission(12_500, rates)).toEqual({
      rateBps: 1500,
      vatRateBps: 2000,
      amountHtCents: 1875,
      amountVatCents: 375,
      amountTtcCents: 2250,
    });
  });

  it('keeps HT + VAT equal to TTC when rounding kicks in', () => {
    // 15 % of 3333 = 499.95 → 500; 20 % of 500 = 100.
    const commission = computeCommission(3333, rates);
    expect(commission.amountHtCents).toBe(500);
    expect(commission.amountVatCents).toBe(100);
    expect(commission.amountHtCents + commission.amountVatCents).toBe(
      commission.amountTtcCents,
    );
  });

  it('returns zero for a zero or negative base', () => {
    expect(computeCommission(0, rates).amountTtcCents).toBe(0);
    expect(computeCommission(-100, rates).amountTtcCents).toBe(0);
  });

  it('never exceeds the charge — Stripe rejects a larger application fee', () => {
    const commission = computeCommission(1000, { rateBps: 9000, vatRateBps: 2000 });
    expect(commission.amountTtcCents).toBe(1000);
    expect(commission.amountHtCents + commission.amountVatCents).toBe(1000);
  });

  it('supports a VAT-free commission', () => {
    expect(computeCommission(10_000, { rateBps: 1000, vatRateBps: 0 })).toMatchObject({
      amountHtCents: 1000,
      amountVatCents: 0,
      amountTtcCents: 1000,
    });
  });
});
