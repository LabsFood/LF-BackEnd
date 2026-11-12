import { HttpException } from '@nestjs/common';

import {
  allergyCheck,
  allergyLabels,
  checkable,
  ClientAllergies,
  conflicts,
  DishAllergens,
  HEALTH_CONSENT,
  menuRefusal,
  newConflicts,
  toDeclaration,
  unverifiedDishes,
} from './allergies.rules';

const NOW = new Date('2026-11-02T10:00:00.000Z');

const client = (over: Partial<ClientAllergies> = {}): ClientAllergies => ({
  allergies: [],
  customAllergies: [],
  allergiesNone: false,
  allergiesDeclaredAt: NOW,
  ...over,
});

const dish = (
  id: string,
  allergens: string[],
  allergensNone = false,
  allergensVerifiedAt: Date | null = NOW,
): DishAllergens => ({
  id,
  allergens,
  allergensNone,
  allergensVerifiedAt,
});

const body = (error: HttpException | null) =>
  error?.getResponse() as Record<string, unknown>;

describe('checkable', () => {
  it('keeps the codes and turns free text naming an allergen into its code', () => {
    const found = checkable(
      client({ allergies: ['milk'], customAllergies: ['  ARACHIDES ', 'kiwi'] }),
      ['Fruits à coque', 'gluten', 'fraise'],
    );
    expect(found.codes.sort()).toEqual(['gluten', 'milk', 'nuts', 'peanuts']);
    expect(found.text).toEqual(['kiwi', 'fraise']);
  });

  it('ignores accents and case', () => {
    expect(checkable(client({ customAllergies: ['oeufs', 'CELERI'] })).codes).toEqual([
      'eggs',
      'celery',
    ]);
  });
});

describe('unverifiedDishes and conflicts', () => {
  const dishes = [
    dish('a', ['peanuts', 'milk']),
    dish('b', [], true),
    dish('c', [], false, null),
  ];

  it('a dish whose allergens were never verified cannot be checked', () => {
    expect(unverifiedDishes(dishes)).toEqual(['c']);
  });

  it('nor one whose allergens the chef has not verified since its ingredients changed', () => {
    expect(unverifiedDishes([dish('d', ['milk'], false, null)])).toEqual(['d']);
  });

  // R27: since the socle, verification is set only on a complete composition and
  // every allergen change clears it, so an empty list no longer means "never declared".
  it('a verified dish whose only allergens are free text is bookable', () => {
    expect(unverifiedDishes([dish('e', [], false)])).toEqual([]);
    expect(
      menuRefusal(client({ allergies: ['milk'] }), [dish('e', [], false)]),
    ).toBeNull();
  });

  it('a verified legacy "none" dish the reprise left incomplete stays bookable', () => {
    // allergens [] and allergensNone false: a line is linked to an entry still to complete.
    expect(unverifiedDishes([dish('f', [], false, NOW)])).toEqual([]);
    expect(allergyCheck(client({ allergiesNone: true }), [dish('f', [], false)])).toEqual(
      {
        allergyCheck: 'verified',
        allergyCheckReasons: [],
        allergyConflicts: [],
      },
    );
  });

  it('an unverified dish is still refused, whatever its allergens say', () => {
    expect(
      unverifiedDishes([dish('g', [], true, null), dish('h', [], false, null)]),
    ).toEqual(['g', 'h']);
    expect(
      body(menuRefusal(client({ allergiesNone: true }), [dish('g', [], true, null)])),
    ).toMatchObject({ code: 'ALLERGENS_UNVERIFIED', mealIds: ['g'] });
  });

  it('lists, per dish, the declared allergens it contains', () => {
    expect(conflicts(['milk', 'eggs'], dishes)).toEqual([
      { mealId: 'a', allergens: ['milk'] },
    ]);
    expect(conflicts([], dishes)).toEqual([]);
  });
});

describe('menuRefusal', () => {
  it('refuses a client who never answered, whatever the dishes', () => {
    expect(body(menuRefusal(null, [dish('a', [], true)]))?.code).toBe(
      'ALLERGIES_NOT_DECLARED',
    );
    expect(
      body(menuRefusal(client({ allergiesDeclaredAt: null }), [dish('a', [], true)]))
        ?.code,
    ).toBe('ALLERGIES_NOT_DECLARED');
  });

  it('then refuses a dish that cannot be checked, before any conflict', () => {
    const refusal = body(
      menuRefusal(client({ allergies: ['milk'] }), [
        dish('a', ['milk']),
        dish('b', [], false, null),
      ]),
    );
    expect(refusal).toMatchObject({ code: 'ALLERGENS_UNVERIFIED', mealIds: ['b'] });
  });

  it('then refuses a dish holding a declared allergen, free text and quote included', () => {
    const refusal = body(
      menuRefusal(
        client({ customAllergies: ['Arachides'] }),
        [dish('a', ['peanuts', 'soy'])],
        ['soja'],
      ),
    );
    expect(refusal).toMatchObject({
      code: 'ALLERGEN_CONFLICT',
      conflicts: [{ mealId: 'a', allergens: ['peanuts', 'soy'] }],
    });
  });

  it('lets a declared client book dishes that are checked and safe', () => {
    expect(
      menuRefusal(client({ allergiesNone: true }), [dish('a', ['milk'])]),
    ).toBeNull();
    expect(
      menuRefusal(client({ allergies: ['eggs'] }), [dish('a', [], true)]),
    ).toBeNull();
  });
});

describe('allergyCheck', () => {
  it('is verified only when nothing is left to check by hand', () => {
    expect(allergyCheck(client({ allergiesNone: true }), [dish('a', ['milk'])])).toEqual({
      allergyCheck: 'verified',
      allergyCheckReasons: [],
      allergyConflicts: [],
    });
  });

  it('says why it is not, every reason at once', () => {
    const check = allergyCheck(
      client({
        allergiesDeclaredAt: null,
        allergies: ['milk'],
        customAllergies: ['kiwi'],
      }),
      [dish('a', ['milk']), dish('b', [], false, null)],
    );
    expect(check.allergyCheck).toBe('unverified');
    expect(check.allergyCheckReasons).toEqual([
      'ALLERGIES_NOT_DECLARED',
      'ALLERGENS_UNVERIFIED',
      'ALLERGEN_CONFLICT',
      'CUSTOM_ALLERGIES',
    ]);
    expect(check.allergyConflicts).toEqual([{ mealId: 'a', allergens: ['milk'] }]);
  });

  it('free text from the quote request also needs a human', () => {
    expect(allergyCheck(client(), [], ['fraise']).allergyCheckReasons).toEqual([
      'CUSTOM_ALLERGIES',
    ]);
  });

  it('a missing profile has answered nothing', () => {
    expect(allergyCheck(null).allergyCheckReasons).toEqual(['ALLERGIES_NOT_DECLARED']);
  });
});

describe('allergyLabels', () => {
  it('names the codes in French, then the free text, once each', () => {
    expect(
      allergyLabels(client({ allergies: ['peanuts'], customAllergies: ['kiwi'] }), [
        'kiwi',
        'fraise',
      ]),
    ).toEqual(['Arachides', 'kiwi', 'fraise']);
  });
});

describe('toDeclaration', () => {
  const consent = { consent: true, consentVersion: HEALTH_CONSENT.version };

  it('"none" empties both lists and answers the question', () => {
    expect(toDeclaration({ none: true }, NOW)).toEqual({
      allergies: [],
      customAllergies: [],
      allergiesNone: true,
      allergiesDeclaredAt: NOW,
    });
  });

  it('"none" next to an allergy is a contradiction', () => {
    expect(() => toDeclaration({ none: true, allergies: ['milk'] }, NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ field: 'allergies' }),
      }),
    );
  });

  it('an empty list must say "none" instead', () => {
    expect(() => toDeclaration({ ...consent, customAllergies: ['  '] }, NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ field: 'allergies' }),
      }),
    );
  });

  it('a list needs consent to the current text', () => {
    for (const input of [
      { allergies: ['milk'] },
      { allergies: ['milk'], consent: true, consentVersion: 'old' },
      { allergies: ['milk'], consent: false, consentVersion: HEALTH_CONSENT.version },
    ]) {
      expect(() => toDeclaration(input, NOW)).toThrow(
        expect.objectContaining({
          response: {
            code: 'HEALTH_CONSENT_REQUIRED',
            message: expect.any(String),
            version: HEALTH_CONSENT.version,
          },
        }),
      );
    }
  });

  it('records the list, once each, with the consent', () => {
    expect(
      toDeclaration(
        {
          ...consent,
          allergies: ['milk', 'milk'],
          customAllergies: [' kiwi ', 'kiwi', ''],
        },
        NOW,
      ),
    ).toEqual({
      allergies: ['milk'],
      customAllergies: ['kiwi'],
      allergiesNone: false,
      allergiesDeclaredAt: NOW,
      healthConsentAt: NOW,
      healthConsentVersion: HEALTH_CONSENT.version,
    });
  });
});

describe('newConflicts', () => {
  it('keeps only the allergens that were not already in conflict on that dish', () => {
    expect(
      newConflicts(
        [{ mealId: 'a', allergens: ['milk'] }],
        [
          { mealId: 'a', allergens: ['milk', 'eggs'] },
          { mealId: 'b', allergens: ['soy'] },
        ],
      ),
    ).toEqual([
      { mealId: 'a', allergens: ['eggs'] },
      { mealId: 'b', allergens: ['soy'] },
    ]);
    expect(newConflicts([{ mealId: 'a', allergens: ['milk'] }], [])).toEqual([]);
  });
});
