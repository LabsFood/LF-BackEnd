import { PrismaService } from '../../prisma/prisma.service';

/**
 * Recettes lot 6, groundwork: the two amounts the grocery flow reads. Editable in
 * the console; the defaults are the decisions of 11/11.
 *
 * - `budgetMaxCents`: the most a client may set as their Budget Courses (100 €).
 * - `recommendedShoppingFeeMinCents`: the forfait courses a batch cooker is advised
 *   to charge at least (15 €). A recommendation: a lower fee is never refused.
 */
export const GROCERIES_KEY = 'groceries';

export interface GroceriesRules {
  budgetMaxCents: number;
  recommendedShoppingFeeMinCents: number;
}

export const DEFAULT_GROCERIES: GroceriesRules = {
  budgetMaxCents: 10_000,
  recommendedShoppingFeeMinCents: 1_500,
};

export const GROCERIES_BOUNDS = {
  budgetMaxCents: { min: 1_000, max: 100_000 },
  recommendedShoppingFeeMinCents: { min: 0, max: 20_000 },
} as const;

type Db = Pick<PrismaService, 'platformSetting'>;

const within = (value: unknown, { min, max }: { min: number; max: number }) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** The rules in force: the admin's values, each falling back on its default. */
export async function groceriesInForce(db: Db): Promise<GroceriesRules> {
  const row = await db.platformSetting.findUnique({ where: { key: GROCERIES_KEY } });
  const saved = (row?.value ?? {}) as Partial<Record<keyof GroceriesRules, unknown>>;
  return {
    budgetMaxCents: within(saved.budgetMaxCents, GROCERIES_BOUNDS.budgetMaxCents)
      ? (saved.budgetMaxCents as number)
      : DEFAULT_GROCERIES.budgetMaxCents,
    recommendedShoppingFeeMinCents: within(
      saved.recommendedShoppingFeeMinCents,
      GROCERIES_BOUNDS.recommendedShoppingFeeMinCents,
    )
      ? (saved.recommendedShoppingFeeMinCents as number)
      : DEFAULT_GROCERIES.recommendedShoppingFeeMinCents,
  };
}
