import { textOf } from '../../common/pdf/pdf.test-helpers';
import { RecipeDocumentInput, renderRecipePdf } from './recipe-document';

const NO_EXTRA = { optional: false, precision: null, preparation: null, group: null };

const INPUT: RecipeDocumentInput = {
  name: 'Poulet rôti aux herbes',
  description: 'Poulet fermier rôti, thym et romarin.',
  category: 'Plat',
  portions: 3,
  prepMinutes: 20,
  cookMinutes: 55,
  version: 2,
  ingredients: [
    { name: 'Poulet fermier', qty: 1.4, unit: 'kg', fixedQuantity: false, ...NO_EXTRA },
    { name: 'Laurier', qty: 2, unit: 'leaf', fixedQuantity: true, ...NO_EXTRA },
  ],
  steps: [
    {
      order: 1,
      text: 'Préchauffer le four à 200 °C.',
      type: 'Préparation',
      durationMinutes: 10,
    },
    { order: 2, text: 'Enfourner 55 min.', type: 'Cuisson', durationMinutes: 55 },
  ],
  allergens: ['Céleri'],
  equipment: ['Cocotte en fonte'],
  storage: 'Réfrigérateur, 3 jours, boîte hermétique',
  reheating: 'Four, 15 min à 160 °C. Couvrir.',
};

describe('renderRecipePdf (Recettes §7)', () => {
  it('carries the recipe: ingredients, typed steps, allergens, keeping and reheating', async () => {
    const pdf = await renderRecipePdf(INPUT);
    const text = textOf(pdf);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    for (const fact of [
      'Poulet rôti aux herbes',
      '1,4 kg',
      '2 feuilles',
      'Poulet fermier',
      'quantité fixe',
      'Préchauffer le four à 200 °C.',
      'CUISSON',
      'Céleri',
      'Cocotte en fonte',
      'Réfrigérateur, 3 jours',
      'Four, 15 min',
      'Version 2',
    ]) {
      expect(text).toContain(fact);
    }
  });

  it('prints each line as displayQuantity, preparation, precision, optional, by group (Recettes §7)', async () => {
    const line = {
      qty: null,
      unit: null,
      fixedQuantity: false,
      optional: false,
      precision: null,
      preparation: null,
      group: null,
    };
    const pdf = await renderRecipePdf({
      ...INPUT,
      ingredients: [
        {
          ...line,
          name: 'Ail',
          qty: 2,
          unit: 'clove',
          preparation: 'haché',
          precision: 'bio',
          optional: true,
          group: 'Sauce',
        },
        { ...line, name: 'Sel', unit: 'to_taste' },
        { ...line, name: 'Farine', qty: 200, unit: 'g', group: 'Pâte' },
      ],
    });
    const text = textOf(pdf).replace(/\s+/g, ' ');

    expect(text).toContain('2 gousses Ail, haché (bio) (facultatif)');
    expect(text).toContain('selon le goût Sel');
    // Lines without a group first, then each group under its label.
    expect(text.indexOf('Sel')).toBeLessThan(text.indexOf('Sauce'));
    expect(text.indexOf('Sauce')).toBeLessThan(text.indexOf('2 gousses Ail'));
    expect(text.indexOf('Pâte')).toBeGreaterThan(text.indexOf('(facultatif)'));
    expect(text).toContain('200 g Farine');
  });

  it('wears the LAB’S FOOD watermark on every page', async () => {
    const steps = Array.from({ length: 40 }, (_, i) => ({
      order: i + 1,
      text: 'Une étape assez longue pour remplir la page. '.repeat(4),
      type: 'Préparation',
      durationMinutes: 5,
    }));
    const raw = (await renderRecipePdf({ ...INPUT, steps })).toString('latin1');
    const pages = (raw.match(/\/Type \/Page\b/g) ?? []).length;
    const marks = textOf(Buffer.from(raw, 'latin1')).split("LAB'S FOOD").length - 1;

    expect(pages).toBeGreaterThan(1);
    expect(marks).toBe(pages);
  });
});
