import { bookingEarnings, EarningsInput } from './earnings';

const RATES = { rateBps: 1500, vatRateBps: 2000 };

const booking = (overrides: Partial<EarningsInput> = {}): EarningsInput => ({
  amountTtc: 20_000,
  priceCents: 20_000,
  payments: [],
  offer: null,
  ...overrides,
});

describe('bookingEarnings', () => {
  it('keeps the deal of a custom request: the cook gets their net', () => {
    const offer = { netCents: 17_000, clientPriceCents: 20_000, commissionBps: 1500 };

    expect(bookingEarnings(booking({ offer }), { ...RATES, rateBps: 4000 })).toEqual({
      netCents: 17_000,
      collectedNetCents: 0,
      commissionCents: 3_000,
      commissionEstimated: true,
    });
  });

  it('prices a direct booking at the rate in force, VAT on the commission', () => {
    // 15 % of 200 € is 30 € HT, 36 € with VAT.
    expect(bookingEarnings(booking(), RATES)).toEqual({
      netCents: 16_400,
      collectedNetCents: 0,
      commissionCents: 3_600,
      commissionEstimated: true,
    });
  });

  it('uses the commission frozen on each payment once fully paid', () => {
    const paid = booking({
      payments: [
        { status: 'succeeded', amountTtc: 20_000, commission: { amountTtcCents: 2_400 } },
      ],
    });

    // The rate changed since the payment: what was taken stays what was taken.
    expect(bookingEarnings(paid, { ...RATES, rateBps: 4000 })).toEqual({
      netCents: 17_600,
      collectedNetCents: 17_600,
      commissionCents: 2_400,
      commissionEstimated: false,
    });
  });

  it('mixes the frozen part and the estimate on a split payment', () => {
    const split = booking({
      payments: [
        { status: 'succeeded', amountTtc: 6_000, commission: { amountTtcCents: 1_080 } },
        // Declared CESU, not confirmed yet: still estimated.
        { status: 'pending', amountTtc: 14_000, commission: { amountTtcCents: 2_520 } },
      ],
    });

    // 14 000 left at 15 % + 20 % VAT = 2 520.
    // Only the 6 000 that succeeded has come in: 6 000 - 1 080.
    expect(bookingEarnings(split, RATES)).toEqual({
      netCents: 16_400,
      collectedNetCents: 4_920,
      commissionCents: 3_600,
      commissionEstimated: true,
    });
  });

  it('reads the price when no TTC amount was stored', () => {
    expect(bookingEarnings(booking({ amountTtc: null }), RATES).commissionCents).toBe(
      3_600,
    );
  });
});
