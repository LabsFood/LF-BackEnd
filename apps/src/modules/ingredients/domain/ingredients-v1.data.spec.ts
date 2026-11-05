import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ALLERGEN_CODES } from '../../dishes/domain/dishes.rules';
import { DEFAULT_RECIPE_AISLES } from '../../platform-settings/recipe-lists';
import { parseIngredientCsv } from './ingredient-csv.rules';

/**
 * Recettes §4 "Liste de départ": the starting list Lab's Food reviews before
 * production. Every dish's computed allergens come from it, so the file must read
 * cleanly and its diets must agree with its allergens.
 */
const FILE = resolve(__dirname, '../../../../prisma/data/ingredients-v1.csv');
const AISLE_CODES = DEFAULT_RECIPE_AISLES.map((aisle) => aisle.code);

describe('ingredients-v1.csv, the starting list (Recettes §4, §7.4)', () => {
  const { rows, errors } = parseIngredientCsv(readFileSync(FILE, 'utf8'), AISLE_CODES);
  const has = (list: string[] | undefined, code: string) => !!list?.includes(code);

  it('reads without a single error', () => {
    expect(errors).toEqual([]);
  });

  it('holds at least 280 ingredients', () => {
    expect(rows.length).toBeGreaterThanOrEqual(280);
  });

  it('uses every one of the 13 aisles', () => {
    const used = new Set(rows.map((row) => row.aisle));
    expect(AISLE_CODES.filter((code) => !used.has(code))).toEqual([]);
  });

  it('names every one of the 14 allergens at least once', () => {
    const used = new Set(rows.flatMap((row) => row.allergens ?? []));
    expect(ALLERGEN_CODES.filter((code) => !used.has(code))).toEqual([]);
  });

  it('writes the implied diets: vegan is vegetarian, vegetarian is no-pork and pescetarian', () => {
    const wrong = rows
      .filter(
        (row) =>
          (has(row.diets, 'vegan') && !has(row.diets, 'vegetarian')) ||
          (has(row.diets, 'vegetarian') &&
            !(has(row.diets, 'no-pork') && has(row.diets, 'pescetarian'))),
      )
      .map((row) => row.name);
    expect(wrong).toEqual([]);
  });

  it('never says gluten-free on an ingredient with gluten', () => {
    const wrong = rows
      .filter((row) => has(row.allergens, 'gluten') && has(row.diets, 'gluten-free'))
      .map((row) => row.name);
    expect(wrong).toEqual([]);
  });

  it('never says lactose-free on an ingredient with milk', () => {
    const wrong = rows
      .filter((row) => has(row.allergens, 'milk') && has(row.diets, 'lactose-free'))
      .map((row) => row.name);
    expect(wrong).toEqual([]);
  });
});
