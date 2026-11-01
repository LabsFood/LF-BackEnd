import { HttpException } from '@nestjs/common';

import {
  aiFormatInvalid,
  allergenConflict,
  allergensUnverified,
  allergiesNotDeclared,
  limitReached,
  menuFrozen,
  recipeNotReady,
  shoppingByClient,
  shoppingListFrozen,
  shoppingListNotSent,
  shoppingListUpdated,
  tierCannotPublish,
} from './content.errors';

const SINCE = new Date('2026-11-02T11:00:00.000Z');

/**
 * The Recettes contract (lots 0 to 5): the fronts pick a popover by `code` and read
 * the details listed here, so the status, the code and the details are fixed by test.
 */
describe('Recettes reason codes', () => {
  it.each<[string, () => HttpException, number, Record<string, unknown>]>([
    ['ALLERGIES_NOT_DECLARED', () => allergiesNotDeclared(), 422, {}],
    [
      'ALLERGEN_CONFLICT',
      () => allergenConflict([{ mealId: 'm1', allergens: ['peanuts'] }]),
      422,
      { conflicts: [{ mealId: 'm1', allergens: ['peanuts'] }] },
    ],
    ['ALLERGENS_UNVERIFIED', () => allergensUnverified(['m1']), 422, { mealIds: ['m1'] }],
    [
      'RECIPE_NOT_READY',
      () =>
        recipeNotReady([
          { code: 'VALIDATION_FAILED', field: 'name', message: 'Name it.' },
        ]),
      422,
      { problems: [{ code: 'VALIDATION_FAILED', field: 'name', message: 'Name it.' }] },
    ],
    ['MENU_FROZEN', () => menuFrozen(SINCE), 409, { frozenSince: SINCE }],
    ['SHOPPING_LIST_NOT_SENT', () => shoppingListNotSent(), 409, {}],
    [
      'SHOPPING_LIST_FROZEN',
      () => shoppingListFrozen(SINCE),
      409,
      { frozenSince: SINCE },
    ],
    ['SHOPPING_LIST_UPDATED', () => shoppingListUpdated(2), 409, { version: 2 }],
    ['SHOPPING_BY_CLIENT', () => shoppingByClient(), 409, {}],
    [
      'LIMIT_REACHED',
      () => limitReached('ingredients', 60),
      422,
      { limit: 'ingredients', max: 60 },
    ],
    ['AI_FORMAT_INVALID', () => aiFormatInvalid(3), 422, { attempts: 3 }],
    ['TIER_CANNOT_PUBLISH', () => tierCannotPublish('tier_1'), 403, { tier: 'tier_1' }],
  ])('%s', (code, make, status, details) => {
    const error = make();

    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual({
      code,
      message: expect.any(String),
      ...details,
    });
  });
});
