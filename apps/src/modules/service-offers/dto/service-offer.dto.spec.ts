import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateServiceOfferDto, UpdateServiceOfferDto } from './service-offer.dto';

const VALID = { name: 'Douceur', priceCents: 18000, mealsIncluded: 3 };

/** As the API's ValidationPipe does: transform, then refuse what is not declared. */
async function check<T extends object>(type: new () => T, body: object) {
  const errors = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('CreateServiceOfferDto', () => {
  it('accepts an offer without a duration', async () => {
    expect(await check(CreateServiceOfferDto, VALID)).toEqual([]);
  });

  it('requires a dish count: more dishes is a custom request', async () => {
    const { mealsIncluded: _, ...noCount } = VALID;
    expect(await check(CreateServiceOfferDto, noCount)).toEqual(['mealsIncluded']);
    expect(await check(CreateServiceOfferDto, { ...VALID, mealsIncluded: null })).toEqual([
      'mealsIncluded',
    ]);
  });

  it('keeps the dish count between 1 and 20', async () => {
    expect(await check(CreateServiceOfferDto, { ...VALID, mealsIncluded: 0 })).toEqual([
      'mealsIncluded',
    ]);
    expect(await check(CreateServiceOfferDto, { ...VALID, mealsIncluded: 21 })).toEqual([
      'mealsIncluded',
    ]);
  });
});

describe('UpdateServiceOfferDto', () => {
  it('leaves the dish count out of a partial update', async () => {
    expect(await check(UpdateServiceOfferDto, { priceCents: 100 })).toEqual([]);
  });

  it('refuses to clear the dish count', async () => {
    expect(await check(UpdateServiceOfferDto, { mealsIncluded: null })).toEqual([
      'mealsIncluded',
    ]);
  });
});
