import { htOf, isLate, netPrice, SERVICE_VAT_RATE_BPS } from './net-price';

describe('netPrice', () => {
  it('splits a 100 € CESU payment at 10 % VAT, 15 % part and 10 % CESU fee', () => {
    const p = netPrice({
      amountTtcCents: 10_000,
      vatRateBps: SERVICE_VAT_RATE_BPS,
      commissionRateBps: 1500,
      cesuFeeBps: 1000,
    });
    expect(p.amountHtCents).toBe(9091);
    expect(p.amountVatCents).toBe(909);
    expect(p.commissionCents).toBe(1364);
    expect(p.cesuFeeCents).toBe(773);
    expect(p.netCents).toBe(9091 - 1364 - 773);
  });

  it('takes no CESU fee on an immediate-advance payment', () => {
    const p = netPrice({
      amountTtcCents: 22_000,
      vatRateBps: 1000,
      commissionRateBps: 1200,
      cesuFeeBps: 0,
    });
    expect(p).toMatchObject({
      amountHtCents: 20_000,
      amountVatCents: 2000,
      commissionCents: 2400,
      cesuFeeCents: 0,
      netCents: 17_600,
    });
  });

  it('keeps HT + VAT equal to the amount received', () => {
    for (const ttc of [1, 99, 12_345, 15_000]) {
      const p = netPrice({
        amountTtcCents: ttc,
        vatRateBps: 550,
        commissionRateBps: 1500,
        cesuFeeBps: 0,
      });
      expect(p.amountHtCents + p.amountVatCents).toBe(ttc);
    }
  });

  it('reads the VAT rate it is given, never a fixed one', () => {
    expect(htOf(12_000, 2000)).toBe(10_000);
    expect(htOf(10_550, 550)).toBe(10_000);
  });
});

describe('isLate', () => {
  const at = (iso: string) => new Date(iso);

  it('is not late within two working days', () => {
    // Wednesday -> Friday evening: Thursday and Friday counted.
    expect(isLate(at('2026-11-25T10:00:00Z'), at('2026-11-27T18:00:00Z'))).toBe(false);
  });

  it('is late on the third working day', () => {
    expect(isLate(at('2026-11-25T10:00:00Z'), at('2026-11-30T11:00:00Z'))).toBe(true);
  });

  it('does not count the weekend', () => {
    // Friday -> Tuesday: Monday and Tuesday only.
    expect(isLate(at('2026-11-27T10:00:00Z'), at('2026-12-01T11:00:00Z'))).toBe(false);
  });
});
