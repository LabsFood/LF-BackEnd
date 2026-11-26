import { PDF_SPEC_TIMEOUT, textOf } from '../../common/pdf/pdf.test-helpers';
import {
  ingredientBlocks,
  RecipeDocumentInput,
  renderRecipePdf,
} from './recipe-document';

jest.setTimeout(PDF_SPEC_TIMEOUT);

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

    expect(text).toMatch(/•\s*2 gousses Ail, haché \(bio\) \(facultatif\)/);
    expect(text).toContain('selon le goût Sel');
    // Each group under its title, in order, then the lines without a group under « Autres » (26/11).
    expect(text.indexOf('Sauce')).toBeLessThan(text.indexOf('2 gousses Ail'));
    expect(text.indexOf('Pâte')).toBeGreaterThan(text.indexOf('(facultatif)'));
    expect(text).toContain('200 g Farine');
    expect(text.indexOf('Autres')).toBeGreaterThan(text.indexOf('200 g Farine'));
    expect(text.indexOf('selon le goût Sel')).toBeGreaterThan(text.indexOf('Autres'));
  });

  it('lists a recipe without groups under bullets, with no « Autres » title', async () => {
    const text = textOf(await renderRecipePdf(INPUT)).replace(/\s+/g, ' ');

    expect(text).toMatch(/•\s*1,4 kg Poulet fermier/);
    expect(text).not.toContain('Autres');
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

describe('ingredientBlocks (retour de recette du 26/11)', () => {
  const l = (name: string, group: string | null = null) => ({
    name,
    qty: 200,
    unit: 'g',
    fixedQuantity: false,
    optional: false,
    precision: null,
    preparation: null,
    group,
  });

  it('puts the groups in order of appearance, then the lines without a group under « Autres »', () => {
    expect(
      ingredientBlocks([
        l('Epice plein sud'),
        l('Butternut', 'Velouté'),
        l('Lait de coco', 'Finition'),
        l('Oignon', 'Velouté'),
      ]),
    ).toEqual([
      { title: 'Velouté', lines: ['200 g Butternut', '200 g Oignon'] },
      { title: 'Finition', lines: ['200 g Lait de coco'] },
      { title: 'Autres', lines: ['200 g Epice plein sud'] },
    ]);
  });

  it('gives a recipe without any group one untitled block', () => {
    expect(ingredientBlocks([l('A'), l('B')])).toEqual([
      { title: null, lines: ['200 g A', '200 g B'] },
    ]);
  });

  it('trims group names, and reads a blank group as no group', () => {
    expect(
      ingredientBlocks([l('A', ' Velouté '), l('B', 'Velouté'), l('C', '   ')]),
    ).toEqual([
      { title: 'Velouté', lines: ['200 g A', '200 g B'] },
      { title: 'Autres', lines: ['200 g C'] },
    ]);
  });

  it('adds the lines without a group to a group the chef already called « Autres »', () => {
    expect(ingredientBlocks([l('A', 'autres'), l('B', 'Sauce'), l('C')])).toEqual([
      { title: 'autres', lines: ['200 g A', '200 g C'] },
      { title: 'Sauce', lines: ['200 g B'] },
    ]);
  });

  it('has no block for a recipe without ingredients', () => {
    expect(ingredientBlocks([])).toEqual([]);
  });
});
