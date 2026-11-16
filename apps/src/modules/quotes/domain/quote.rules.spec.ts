import {
  expressDecisionBlock,
  offerDishLines,
  parisToday,
  priceOffer,
  slotWindow,
} from './quote.rules';

describe('quote rules', () => {
  describe('priceOffer', () => {
    it('takes the commission out of the client price, leaving the net', () => {
      // 15 %: 85 % of the client price is the net.
      expect(priceOffer(17_000, 1500)).toEqual({
        clientPriceCents: 20_000,
        commissionCents: 3_000,
        afterTaxCreditCents: 10_000,
      });
    });

    it('rounds to the cent once', () => {
      const offer = priceOffer(10_000, 1500);
      expect(offer.clientPriceCents).toBe(11_765);
      expect(offer.commissionCents).toBe(1_765);
      expect(offer.afterTaxCreditCents).toBe(5_883);
    });

    it('with no commission the client pays the net', () => {
      expect(priceOffer(12_345, 0)).toMatchObject({
        clientPriceCents: 12_345,
        commissionCents: 0,
      });
    });
  });

  describe('slotWindow', () => {
    it('reads the hours as Paris hours in summer (UTC+2)', () => {
      const { startsAt, endsAt, label } = slotWindow(new Date('2026-07-15'), 'morning');
      expect(startsAt.toISOString()).toBe('2026-07-15T07:00:00.000Z');
      expect(endsAt.toISOString()).toBe('2026-07-15T11:00:00.000Z');
      expect(label).toBe('09:00-13:00');
    });

    it('and in winter (UTC+1)', () => {
      const { startsAt, endsAt } = slotWindow(new Date('2026-12-15'), 'evening');
      expect(startsAt.toISOString()).toBe('2026-12-15T17:00:00.000Z');
      expect(endsAt.toISOString()).toBe('2026-12-15T21:00:00.000Z');
    });
  });

  it('parisToday is the Paris calendar day, not the UTC one', () => {
    // 23:30 UTC on the 14th is already the 15th in Paris in summer.
    expect(parisToday(new Date('2026-07-14T23:30:00.000Z')).toISOString()).toBe(
      '2026-07-15T00:00:00.000Z',
    );
  });
});

describe('offerDishLines', () => {
  it('reads menus first, then dishes, then express ones, each dish once', () => {
    expect(
      offerDishLines({
        menus: [
          { id: 'm1', dishIds: ['a', 'b'] },
          { id: 'm2', dishIds: ['b', 'c'] },
        ],
        dishIds: ['c', 'd'],
        expressIds: ['x'],
      }),
    ).toEqual([
      { mealId: 'a', menuId: 'm1', position: 0 },
      { mealId: 'b', menuId: 'm1', position: 1 },
      { mealId: 'c', menuId: 'm2', position: 2 },
      { mealId: 'd', menuId: null, position: 3 },
      { mealId: 'x', menuId: null, position: 4 },
    ]);
  });
});

describe('expressDecisionBlock', () => {
  it('waits for an offer the client can still accept', () => {
    expect(expressDecisionBlock({ offers: ['viewed'], bookings: [] })).toBe(
      'OFFER_PENDING',
    );
  });

  it('waits for a prestation still to cook', () => {
    expect(expressDecisionBlock({ offers: ['accepted'], bookings: ['cooking'] })).toBe(
      'PRESTATION_PENDING',
    );
  });

  it('lets the batch cooker decide once delivered, or when no offer went through', () => {
    expect(
      expressDecisionBlock({ offers: ['accepted'], bookings: ['delivered'] }),
    ).toBeNull();
    expect(
      expressDecisionBlock({ offers: ['declined', 'expired'], bookings: [] }),
    ).toBeNull();
    expect(
      expressDecisionBlock({ offers: ['accepted'], bookings: ['cancelled'] }),
    ).toBeNull();
  });
});
