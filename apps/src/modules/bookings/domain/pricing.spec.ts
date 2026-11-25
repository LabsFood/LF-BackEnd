import {
  bookingAmounts,
  DEFAULT_SUPPLEMENT_RULES as RULES,
  reprice,
  shoppingFee,
  supplementRulesInForce,
  supplementsFor,
} from './pricing';

describe('booking pricing', () => {
  it('charges adults beyond those included, the extra dishes asked for, and the shopping apart', () => {
    const lines = supplementsFor(
      { persons: 5, extraMeals: 3, shoppingFeeCents: 1500, formule: false },
      RULES,
    );

    expect(lines).toEqual({
      extraPersonsCents: 3000, // 2 × 15 €
      extraMealsCents: 2400, // 3 × 8 €
      shoppingFeeCents: 1500,
    });
    expect(bookingAmounts(18000, lines)).toEqual({
      priceCents: 18000,
      ...lines,
      amountTtc: 24900,
      amountAfterTax: 12450,
    });
  });

  it('adds nothing within what the price covers, or with no headcount given', () => {
    expect(
      supplementsFor(
        { persons: 3, extraMeals: 0, shoppingFeeCents: 0, formule: false },
        RULES,
      ),
    ).toEqual({ extraPersonsCents: 0, extraMealsCents: 0, shoppingFeeCents: 0 });
    expect(
      supplementsFor(
        { persons: null, extraMeals: 0, shoppingFeeCents: 0, formule: false },
        RULES,
      ),
    ).toEqual({ extraPersonsCents: 0, extraMealsCents: 0, shoppingFeeCents: 0 });
  });

  it('treats a formule as a package: the shopping only, its own after-credit price', () => {
    const lines = supplementsFor(
      { persons: 8, extraMeals: 4, shoppingFeeCents: 1000, formule: true },
      RULES,
    );

    expect(lines).toEqual({
      extraPersonsCents: 0,
      extraMealsCents: 0,
      shoppingFeeCents: 1000,
    });
    expect(bookingAmounts(24900, lines, 12450)).toMatchObject({
      amountTtc: 25900,
      amountAfterTax: 12950,
    });
  });

  it('charges the shopping only when the batch cooker does it', () => {
    const offer = { shoppingIncluded: true, shoppingFeeCents: 1500 };
    expect(shoppingFee(offer, false)).toBe(1500);
    expect(shoppingFee(offer, true)).toBe(0);
    expect(shoppingFee({ ...offer, shoppingIncluded: false }, false)).toBe(0);
  });

  it('reprices by the difference, keeping the base price and an admin’s amount', () => {
    const booked = {
      priceCents: 18000,
      extraPersonsCents: 0,
      extraMealsCents: 0,
      shoppingFeeCents: 1500,
      amountTtc: 19000, // an admin's discount of 5 €
      amountAfterTax: 9500,
    };

    expect(
      reprice(booked, {
        extraPersonsCents: 1500,
        extraMealsCents: 800,
        shoppingFeeCents: 0,
      }),
    ).toEqual({
      extraPersonsCents: 1500,
      extraMealsCents: 800,
      shoppingFeeCents: 0,
      amountTtc: 19800,
      amountAfterTax: 9900,
    });
  });

  it('reads the saved rules, falling back field by field', async () => {
    const db = {
      platformSetting: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ value: { extraMealCents: 1000, includedPersons: -1 } }),
      },
    };

    await expect(supplementRulesInForce(db as never)).resolves.toEqual({
      ...RULES,
      extraMealCents: 1000,
    });
  });
});
