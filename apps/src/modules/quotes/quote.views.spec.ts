import { LoadedQuote, toQuoteView } from './quote.views';

const offer = (status: string, dishes: unknown[] = []) => ({
  id: `offer-${status}`,
  status,
  netCents: 17_000,
  commissionBps: 1500,
  clientPriceCents: 20_000,
  afterTaxCreditCents: 10_000,
  proposedDate: null,
  proposedTimeSlot: null,
  conditions: null,
  validUntil: new Date('2026-11-01T00:00:00Z'),
  viewedAt: null,
  decidedAt: null,
  declineReason: null,
  createdAt: new Date('2026-10-20T00:00:00Z'),
  dishes,
});

const quote = (over: Record<string, unknown> = {}) =>
  ({
    id: 'q1',
    reference: 'DEM-2026-0001',
    status: 'quoted',
    title: 'Dîner',
    diet: [],
    allergies: [],
    desiredDate: new Date('2026-11-10T00:00:00Z'),
    addressLine: '12 rue des Lilas',
    addressCity: 'Nice',
    addressPostalCode: '06000',
    chefDeclineReason: 'Pas disponible.',
    client: {
      id: 'u1',
      fullName: 'Sophie Marchand',
      email: 'sophie@exemple.fr',
      phone: '+33600000000',
      clientProfile: null,
    },
    offers: [offer('sent'), offer('declined')],
    booking: null,
    ...over,
  }) as unknown as LoadedQuote;

describe('toQuoteView', () => {
  it('never shows the client the net nor the commission', () => {
    const view = toQuoteView(quote(), null, 'client');

    expect(view.activeOffer).toMatchObject({ clientPriceCents: 20_000 });
    for (const shown of view.offers) {
      expect(shown).not.toHaveProperty('netCents');
      expect(shown).not.toHaveProperty('commissionBps');
    }
    expect(view.chefDeclineReason).toBeUndefined();
  });

  it('gives the batch cooker the town only, until the offer is accepted', () => {
    const before = toQuoteView(quote(), null, 'chef');
    expect(before.address).toEqual({ line: null, city: 'Nice', postalCode: '06000' });
    expect(before.client).toMatchObject({ name: 'Sophie M.', email: null, phone: null });
    expect(before.activeOffer).toMatchObject({ netCents: 17_000, commissionBps: 1500 });

    const after = toQuoteView(quote({ status: 'accepted' }), null, 'chef');
    expect(after.address.line).toBe('12 rue des Lilas');
    expect(after.client).toMatchObject({
      name: 'Sophie Marchand',
      email: 'sophie@exemple.fr',
    });
  });

  it('shows the admin everything, the decline reason included', () => {
    const view = toQuoteView(quote(), null, 'admin');

    expect(view.address.line).toBe('12 rue des Lilas');
    expect(view.client?.email).toBe('sophie@exemple.fr');
    expect(view.chefDeclineReason).toBe('Pas disponible.');
  });

  it('has no active offer once every offer is settled', () => {
    const view = toQuoteView(quote({ offers: [offer('declined')] }), null, 'chef');

    expect(view.activeOffer).toBeNull();
    expect(view.offers).toHaveLength(1);
  });

  describe('dishes of an offer', () => {
    const dish = (over: Record<string, unknown> = {}) => ({
      meal: {
        id: 'dish-1',
        name: 'Chili sin carne',
        description: null,
        imageUrl: null,
        allergens: [],
        allergensNone: true,
        allergensVerifiedAt: new Date('2026-10-01T00:00:00Z'),
        expressQuoteId: null,
        ...over,
      },
      menu: null,
    });
    const declared = {
      allergies: ['eggs'],
      customAllergies: [],
      allergiesNone: false,
      allergiesDeclaredAt: new Date('2026-10-01T00:00:00Z'),
    };

    it('has no warning when the offer carries no dish', () => {
      const view = toQuoteView(quote(), null, 'client');
      expect(view.activeOffer?.dishes).toEqual([]);
      expect(view.activeOffer?.allergy).toBeNull();
    });

    it('says verified when every dish is verified and none meets an allergy', () => {
      const view = toQuoteView(
        quote({
          offers: [offer('sent', [dish()])],
          client: {
            id: 'u1',
            fullName: 'S',
            email: null,
            phone: null,
            clientProfile: declared,
          },
        }),
        null,
        'client',
      );
      expect(view.activeOffer?.allergy).toEqual({
        check: 'verified',
        reasons: [],
        conflicts: [],
      });
    });

    it('warns on an express dish (never verified) and names the allergen it brings', () => {
      const view = toQuoteView(
        quote({
          offers: [
            offer('sent', [
              dish({
                id: 'express-1',
                name: 'Gâteau',
                allergens: ['eggs', 'milk'],
                allergensNone: false,
                allergensVerifiedAt: null,
                expressQuoteId: 'q1',
              }),
            ]),
          ],
          client: {
            id: 'u1',
            fullName: 'S',
            email: null,
            phone: null,
            clientProfile: declared,
          },
        }),
        null,
        'chef',
      );
      expect(view.activeOffer?.dishes[0]).toMatchObject({
        express: true,
        allergensVerified: false,
      });
      expect(view.activeOffer?.allergy).toEqual({
        check: 'unverified',
        reasons: ['ALLERGENS_UNVERIFIED', 'ALLERGEN_CONFLICT'],
        conflicts: [{ mealId: 'express-1', allergens: ['eggs'] }],
      });
    });

    it('also reads the allergies written in the request', () => {
      const view = toQuoteView(
        quote({
          allergies: ['Arachides'],
          offers: [
            offer('sent', [dish({ allergens: ['peanuts'], allergensNone: false })]),
          ],
          client: {
            id: 'u1',
            fullName: 'S',
            email: null,
            phone: null,
            clientProfile: declared,
          },
        }),
        null,
        'client',
      );
      expect(view.activeOffer?.allergy?.conflicts).toEqual([
        { mealId: 'dish-1', allergens: ['peanuts'] },
      ]);
    });
  });
});
