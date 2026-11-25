import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateMealDto } from './catalog-admin.dto';

// The API's own pipe options (main.ts): a field the DTO does not know is refused.
const errorsFor = async (body: object) =>
  (
    await validate(plainToInstance(CreateMealDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((e) => e.property);

describe('CreateMealDto', () => {
  const base = { name: 'Poulet yassa', prepTime: 45 };

  it('accepts ingredients as a list of { name, qty, unit, aisle }', async () => {
    expect(
      await errorsFor({
        ...base,
        ingredients: [
          { name: 'Oignons', qty: 4, unit: 'piece', aisle: 'fruits-legumes' },
        ],
      }),
    ).toEqual([]);
  });

  it('refuses ingredients sent as an object, or as incomplete lines', async () => {
    expect(await errorsFor({ ...base, ingredients: { oignons: 4 } })).toContain(
      'ingredients',
    );
    expect(await errorsFor({ ...base, ingredients: [{ qty: 4 }] })).toContain(
      'ingredients',
    );
  });

  it('accepts only the 14 regulated allergens as added ones, and the listed diets', async () => {
    expect(await errorsFor({ ...base, addedAllergens: ['dairy'] })).toContain(
      'addedAllergens',
    );
    expect(await errorsFor({ ...base, addedAllergens: ['milk', 'milk'] })).toContain(
      'addedAllergens',
    );
    expect(await errorsFor({ ...base, dietaryTags: ['demo'] })).toContain('dietaryTags');
    expect(
      await errorsFor({ ...base, addedAllergens: ['milk'], dietaryTags: ['halal'] }),
    ).toEqual([]);
  });

  it('refuses allergens and allergensNone: they are computed (Recettes §6.1)', async () => {
    expect(await errorsFor({ ...base, allergens: ['milk'] })).toContain('allergens');
    expect(await errorsFor({ ...base, allergensNone: true })).toContain('allergensNone');
  });

  it('wants the country as an ISO 3166 alpha-2 code', async () => {
    expect(await errorsFor({ ...base, country: 'Sénégal' })).toContain('country');
    expect(await errorsFor({ ...base, country: 'SN' })).toEqual([]);
  });
});
