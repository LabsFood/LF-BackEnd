import { hasMenuProblems, isMonday, menuPublishProblems } from './menus.rules';

const dish = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'Pho Bo',
  status: 'draft',
  country: 'VN',
  portions: 4,
  allergens: ['soy'],
  allergensNone: false,
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

  it('checks a draft dish as if it were published on its own', () => {
    const problems = menuPublishProblems({ title: 'Semaine' }, [dish({ allergens: [] })]);
    expect(problems.dishes).toEqual([
      expect.objectContaining({
        dishId: 'd1',
        problems: [expect.objectContaining({ code: 'ALLERGENS_REQUIRED' })],
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
      dish({ status: 'published', allergens: [] }),
    ]);
    expect(hasMenuProblems(problems)).toBe(false);
  });
});
