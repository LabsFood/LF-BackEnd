import { Meal } from '../../generated/prisma/client';
import { dishRow } from './dishes.test-helpers';
import { toDishView, toLabsFoodMealView } from './dishes.views';

/** A line as a V4 save stores it: every field written, stamped from its entry. */
const STAMPED = {
  name: 'Céleri-rave',
  qty: 200,
  unit: 'g',
  aisle: 'fruits-legumes',
  link: null,
  toVerify: false,
  fixedQuantity: false,
  catalogIngredientId: 'cat-celeri',
  optional: true,
  precision: 'bio',
  preparation: 'en dés',
  group: 'Pour la purée',
  hiddenFromClient: false,
  rawText: null,
  allergens: ['celery'],
  incomplete: false,
};

const meal = (over: Record<string, unknown> = {}) => dishRow(over) as unknown as Meal;

// R33: the views serve lines as the rules read them (`readLines`), so a form never
// holds a line it cannot send back and drops it on the next save of any field.
describe.each([
  ['toDishView', (m: Meal) => toDishView(m).recipe],
  ['toLabsFoodMealView', (m: Meal) => toLabsFoodMealView(m)],
])('%s serves lines and steps as the rules read them (R33)', (_name, view) => {
  it('serves a linked, stamped line unchanged, every stamp field kept', () => {
    expect(view(meal({ ingredients: [STAMPED] })).ingredients).toEqual([STAMPED]);
  });

  it('serves a unit outside the 14 that cannot be mapped as to verify, with the words', () => {
    const [line] = view(
      meal({ ingredients: [{ name: 'Basilic', qty: 1, unit: 'poignée' }] }),
    ).ingredients;
    expect(line).toMatchObject({
      unit: null,
      toVerify: true,
      rawText: '1 poignée Basilic',
    });
  });

  it('serves a legacy unit of the §9 table under its code, as the rules read it', () => {
    const [line] = view(
      meal({ ingredients: [{ name: 'Tomate', qty: 2, unit: 'pièce' }] }),
    ).ingredients;
    expect(line).toMatchObject({ unit: 'piece', qty: 2, toVerify: false });
  });

  it('serves a quantity it cannot read as to verify, with the words', () => {
    const [line] = view(
      meal({
        ingredients: [
          {
            ...STAMPED,
            qty: '1/2',
            allergens: ['celery'],
            catalogIngredientId: 'cat-celeri',
          },
        ],
      }),
    ).ingredients;
    expect(line).toMatchObject({
      qty: null,
      toVerify: true,
      rawText: '1/2 g Céleri-rave',
      catalogIngredientId: 'cat-celeri',
      allergens: ['celery'],
    });
  });

  it('serves legacy string steps as step objects', () => {
    expect(view(meal({ steps: ['Éplucher.', 'Cuire 20 min.'] })).steps).toEqual([
      { order: 1, text: 'Éplucher.', type: null, durationMinutes: null },
      { order: 2, text: 'Cuire 20 min.', type: null, durationMinutes: null },
    ]);
  });

  it('only reads: the stored row is left as it was', () => {
    const row = meal({ ingredients: [{ name: 'Basilic', qty: 1, unit: 'poignée' }] });
    const before = JSON.stringify(row);
    view(row);
    expect(JSON.stringify(row)).toBe(before);
  });
});

// Ruling R30 (§8.1): the admin's form sends back the lockVersion it read, and shows
// which line brings each allergen, as the chef's view does.
describe('toLabsFoodMealView lockVersion and allergenSources (ruling R30)', () => {
  it('returns the lockVersion and, per allergen, the lines that bring it', () => {
    const view = toLabsFoodMealView(
      meal({
        lockVersion: 6,
        chefProfileId: null,
        ingredients: [
          STAMPED,
          {
            ...STAMPED,
            name: 'Beurre',
            catalogIngredientId: 'cat-beurre',
            allergens: ['milk'],
            optional: false,
          },
        ],
        addedAllergens: ['mustard'],
      }),
    );

    expect(view.lockVersion).toBe(6);
    expect(view.allergenSources).toEqual(
      toDishView(
        meal({
          ingredients: [
            STAMPED,
            {
              ...STAMPED,
              name: 'Beurre',
              catalogIngredientId: 'cat-beurre',
              allergens: ['milk'],
              optional: false,
            },
          ],
          addedAllergens: ['mustard'],
        }),
      ).allergenSources,
    );
    expect(view.allergenSources).toMatchObject({
      celery: ['Céleri-rave'],
      milk: ['Beurre'],
    });
  });
});
