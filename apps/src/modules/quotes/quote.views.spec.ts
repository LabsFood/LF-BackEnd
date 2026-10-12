import { LoadedQuote, toQuoteView } from './quote.views';

const offer = (status: string) => ({
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
});
