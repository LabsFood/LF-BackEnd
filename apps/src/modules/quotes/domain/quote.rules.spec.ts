import { parisToday, priceOffer, slotWindow } from './quote.rules';

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
