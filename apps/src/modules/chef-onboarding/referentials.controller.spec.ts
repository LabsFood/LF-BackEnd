import { ReferentialsController } from './referentials.controller';

describe('ReferentialsController', () => {
  const controller = new ReferentialsController();

  it('lists the 14 units with their label and plural (Recettes §4.12)', () => {
    const { units } = controller.units();

    expect(units).toHaveLength(14);
    expect(units).toContainEqual({ code: 'clove', label: 'gousse', plural: 'gousses' });
    expect(units).toContainEqual({ code: 'g', label: 'g', plural: 'g' });
  });

  it('lists the seven dish types (Recettes §4.1)', () => {
    const { categories } = controller.categories();

    expect(categories.map((c) => c.code)).toEqual([
      'main',
      'starter',
      'soup',
      'side',
      'dessert',
      'breakfast',
      'sauce',
    ]);
  });
});
