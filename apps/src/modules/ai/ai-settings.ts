/**
 * Budget IA et import de recettes : les réglages modifiables depuis la console, dans
 * `platform_settings` comme les autres (lus à chaque usage, sans cache).
 */

import { PrismaService } from '../../prisma/prisma.service';
import { budgetsFrom, type AiBudgets } from './domain/ai-budget.rules';
import { pricesFrom, type AiPrices } from './domain/ai-prices.rules';

export const AI_BUDGETS_KEY = 'ai_budgets';
export const AI_PRICES_KEY = 'ai_prices';
export const RECIPE_IMPORT_KEY = 'recipe_import';

type Db = Pick<PrismaService, 'platformSetting'>;

const read = async (db: Db, key: string) =>
  (await db.platformSetting.findUnique({ where: { key } }))?.value ?? null;

export const budgetsInForce = async (db: Db): Promise<AiBudgets> =>
  budgetsFrom(await read(db, AI_BUDGETS_KEY));

export const pricesInForce = async (db: Db): Promise<AiPrices> =>
  pricesFrom(await read(db, AI_PRICES_KEY));

/**
 * L'import de recettes : éteint, ouvert aux seuls cuisiniers de la bêta, ou à tous.
 * Éteint par défaut : rien ne s'ouvre sans décision dans la console.
 */
export type RecipeImportMode = 'off' | 'beta' | 'all';

export interface RecipeImportSettings {
  mode: RecipeImportMode;
  betaChefProfileIds: string[];
}

export const DEFAULT_RECIPE_IMPORT: RecipeImportSettings = {
  mode: 'off',
  betaChefProfileIds: [],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recipeImportFrom(value: unknown): RecipeImportSettings {
  const v = value as Partial<RecipeImportSettings> | null;
  if (!v || typeof v !== 'object') return DEFAULT_RECIPE_IMPORT;
  const mode: RecipeImportMode = v.mode === 'beta' || v.mode === 'all' ? v.mode : 'off';
  const ids = Array.isArray(v.betaChefProfileIds)
    ? v.betaChefProfileIds.filter(
        (id): id is string => typeof id === 'string' && UUID.test(id),
      )
    : [];
  return { mode, betaChefProfileIds: [...new Set(ids)] };
}

export const recipeImportInForce = async (db: Db): Promise<RecipeImportSettings> =>
  recipeImportFrom(await read(db, RECIPE_IMPORT_KEY));

export const recipeImportOpenTo = (
  settings: RecipeImportSettings,
  chefProfileId: string,
) =>
  settings.mode === 'all' ||
  (settings.mode === 'beta' && settings.betaChefProfileIds.includes(chefProfileId));
