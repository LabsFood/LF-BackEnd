import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateQuoteDto, CreateQuoteOfferDto, MAX_BUDGET_CENTS } from './quote.dto';

const VALID = {
  title: 'Dîner d’anniversaire pour 12',
  desiredDate: '2026-11-14',
  timeSlot: 'evening',
  persons: 12,
  mealsCount: 3,
  cuisine: 'Méditerranéenne',
  brief: 'Dîner dans le jardin, service simple.',
  addressLine: '12 rue des Lilas',
  addressCity: 'Nice',
  addressPostalCode: '06000',
};

/** As the API's ValidationPipe does: transform, then refuse what is not declared. */
async function check<T extends object>(type: new () => T, body: object) {
  const dto = plainToInstance(type, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((error) => error.property) };
}

describe('CreateQuoteDto', () => {
  it('accepts a well-formed request', async () => {
    expect((await check(CreateQuoteDto, VALID)).fields).toEqual([]);
  });

  it('cleans what it stores: control characters, line breaks, doubled spaces', async () => {
    const { dto, fields } = await check(CreateQuoteDto, {
      ...VALID,
      title: '  Dîner\u0000 de\n\n fête   ',
      brief: 'Première ligne.\r\nDeuxième\u0007 ligne.  ',
    });

    expect(fields).toEqual([]);
    expect(dto.title).toBe('Dîner de fête');
    expect(dto.brief).toBe('Première ligne.\nDeuxième ligne.');
  });

  it('cleans the lists: trimmed, no empty label, no double', async () => {
    const { dto, fields } = await check(CreateQuoteDto, {
      ...VALID,
      allergies: [' gluten ', '', 'Gluten', 'fruits à coque'],
    });

    expect(fields).toEqual([]);
    expect(dto.allergies).toEqual(['gluten', 'fruits à coque']);
  });

  it.each([
    ['a title with no letter', { title: '-----' }],
    ['a title that is only spaces', { title: '      ' }],
    ['a brief with no letter', { brief: '1234567890 !!!' }],
    ['a postcode that is not five digits', { addressPostalCode: '0600A' }],
    ['a postcode too short', { addressPostalCode: '0600' }],
    ['a town that is a number', { addressCity: '12345' }],
    ['an address with no street name', { addressLine: '12 34' }],
    ['a date that is not a calendar day', { desiredDate: '2026-02-30' }],
    ['a date with a time', { desiredDate: '2026-11-14T10:00:00Z' }],
    ['an unknown slot', { timeSlot: 'night' }],
    ['a head count of zero', { persons: 0 }],
    ['a head count that is not a number', { persons: 'douze' }],
    ['a fractional number of dishes', { mealsCount: 2.5 }],
    ['a negative budget', { budgetCents: -1 }],
    ['an absurd budget', { budgetCents: MAX_BUDGET_CENTS + 1 }],
    ['a batch cooker id that is not one', { chefProfileId: 'alice' }],
    ['a label that is not text', { diet: [42] }],
    ['a label far too long', { allergies: ['x'.repeat(61)] }],
    ['too many labels', { diet: Array.from({ length: 21 }, (_, i) => `régime ${i}`) }],
    ['a field nobody declared', { status: 'accepted' }],
    ['a price slipped in by the client', { clientPriceCents: 1 }],
  ])('refuses %s', async (_label, over) => {
    const { fields } = await check(CreateQuoteDto, { ...VALID, ...over });

    expect(fields).toEqual([Object.keys(over)[0]]);
  });

  it('refuses a missing required field', async () => {
    const { addressCity: _dropped, ...rest } = VALID;

    expect((await check(CreateQuoteDto, rest)).fields).toEqual(['addressCity']);
  });
});

describe('CreateQuoteOfferDto', () => {
  it.each([
    ['a net below the floor', { netCents: 999 }],
    ['a net above the ceiling', { netCents: 2_000_001 }],
    ['a net with cents of cents', { netCents: 17000.5 }],
    ['a net that is not a number', { netCents: 'beaucoup' }],
    ['a validity of zero days', { netCents: 17000, validityDays: 0 }],
    ['a validity over a month', { netCents: 17000, validityDays: 31 }],
    ['a proposed date that is not a day', { netCents: 17000, proposedDate: 'demain' }],
    ['a client price chosen by the cook', { netCents: 17000, clientPriceCents: 1 }],
    ['a commission chosen by the cook', { netCents: 17000, commissionBps: 0 }],
  ])('refuses %s', async (_label, body) => {
    expect((await check(CreateQuoteOfferDto, body)).fields).toHaveLength(1);
  });

  it('accepts a plain offer', async () => {
    const { fields } = await check(CreateQuoteOfferDto, {
      netCents: 17000,
      conditions: 'Courses incluses.',
    });

    expect(fields).toEqual([]);
  });
});
