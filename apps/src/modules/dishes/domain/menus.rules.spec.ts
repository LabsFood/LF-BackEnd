import { hasMenuProblems, isMonday, menuPublishProblems } from './menus.rules';

/** A draft dish that passes the Recettes §4.11 check. */
const dish = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'Pho Bo',
  status: 'draft',
  category: 'main',
  portions: 4,
  cookTime: 180,
  description: 'Bouillon de bœuf parfumé.',
  imageUrl: 'https://photos.example.com/pho.jpg',
  ingredients: [
    {
      name: 'Bœuf',
      qty: 1,
      unit: 'kg',
      aisle: 'boucherie',
      catalogIngredientId: 'cat-1',
      allergens: [],
      incomplete: false,
    },
  ],
  steps: [{ text: 'Mijoter', type: 'cuisson' }],
  storage: { method: 'fridge', days: 3, freezable: false },
  reheating: { modes: ['saucepan'], note: 'Porter à ébullition.' },
  allergens: ['soy'],
  allergensNone: false,
  declaredDiets: [] as string[],
  classification: { diets: ['no-pork'], seasonMonths: [1, 2] },
  seasonsOverride: [] as number[],
  allergensVerifiedAt: new Date('2026-11-01T09:00:00.000Z'),
  ...overrides,
});

describe('isMonday', () => {
  it('accepts a Monday and nothing else', () => {
    expect(isMonday('2026-09-28')).toBe(true);
    expect(isMonday('2026-09-27')).toBe(false);
    expect(isMonday('2026-02-30')).toBe(false);
    expect(isMonday('28/09/2026')).toBe(false);
  });
});

describe('menuPublishProblems (§3.4)', () => {
  it('lets a titled menu of publishable dishes through', () => {
    const problems = menuPublishProblems({ title: 'Semaine vietnamienne' }, [
      dish(),
      dish({ id: 'd2', status: 'published' }),
    ]);
    expect(hasMenuProblems(problems)).toBe(false);
  });

  it('needs a title and at least one dish', () => {
    const problems = menuPublishProblems({ title: ' ' }, []);
    expect(problems.menu.map((p) => p.field)).toEqual(['title', 'dishIds']);
  });

  it('checks a draft dish as if it were published on its own (Recettes §4.11)', () => {
    const problems = menuPublishProblems({ title: 'Semaine' }, [
      dish({ allergensVerifiedAt: null }),
    ]);
    expect(problems.dishes).toEqual([
      expect.objectContaining({
        dishId: 'd1',
        problems: [expect.objectContaining({ code: 'ALLERGENS_UNVERIFIED' })],
      }),
    ]);
  });

  it('never lifts a suspension', () => {
    const problems = menuPublishProblems({ title: 'Semaine' }, [
      dish({ status: 'suspended' }),
    ]);
    expect(problems.dishes[0].problems[0].field).toBe('status');
  });

  it('does not re-check a dish that is already published', () => {
    const problems = menuPublishProblems({ title: 'Semaine' }, [
      dish({ status: 'published', allergensVerifiedAt: null }),
    ]);
    expect(hasMenuProblems(problems)).toBe(false);
  });
});
