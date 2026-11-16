import { PrismaService } from '../../prisma/prisma.service';

/**
 * Recettes lot 6: what the grocery flow reads, editable in the console. The defaults
 * are the decisions of 11/11 and 16/11.
 *
 * - `budgetMaxCents`: the Budget Courses, the same for every client (decision of
 *   16/11: always the ceiling) and the amount of the hold (100 €).
 * - `recommendedShoppingFeeMinCents`: the forfait courses a batch cooker is advised
 *   to charge at least (15 €). A recommendation: a lower fee is never refused.
 * - `minCancelNoticeMinutes`: the cancel deadline of the message before the
 *   groceries is never sooner than this after the message (2 h).
 * - `silenceConfirms`: « le silence vaut confirmation » (art. 8). Off until legal
 *   says so (decision of 16/11): off, the client must click « Confirmer les courses ».
 * - `instantPayoutFeeBps` / `instantPayoutFeeMinCents`: what a batch cooker pays for
 *   an instant payout of their reimbursement (decision of 16/11: an option, at their
 *   charge).
 */
export const GROCERIES_KEY = 'groceries';

export interface GroceriesRules {
  budgetMaxCents: number;
  recommendedShoppingFeeMinCents: number;
  minCancelNoticeMinutes: number;
  silenceConfirms: boolean;
  instantPayoutFeeBps: number;
  instantPayoutFeeMinCents: number;
}

export const DEFAULT_GROCERIES: GroceriesRules = {
  budgetMaxCents: 10_000,
  recommendedShoppingFeeMinCents: 1_500,
  minCancelNoticeMinutes: 120,
  silenceConfirms: false,
  instantPayoutFeeBps: 150,
  instantPayoutFeeMinCents: 50,
};

export const GROCERIES_BOUNDS = {
  budgetMaxCents: { min: 1_000, max: 100_000 },
  recommendedShoppingFeeMinCents: { min: 0, max: 20_000 },
  minCancelNoticeMinutes: { min: 30, max: 1_440 },
  instantPayoutFeeBps: { min: 0, max: 1_000 },
  instantPayoutFeeMinCents: { min: 0, max: 1_000 },
} as const;

type Db = Pick<PrismaService, 'platformSetting'>;
type NumberKey = keyof typeof GROCERIES_BOUNDS;

const within = (value: unknown, { min, max }: { min: number; max: number }) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** Each saved value checked against its bounds, the default otherwise. */
export function readGroceries(saved: Partial<Record<keyof GroceriesRules, unknown>>) {
  const rules = { ...DEFAULT_GROCERIES };
  for (const key of Object.keys(GROCERIES_BOUNDS) as NumberKey[]) {
    if (within(saved[key], GROCERIES_BOUNDS[key])) rules[key] = saved[key] as number;
  }
  if (typeof saved.silenceConfirms === 'boolean')
    rules.silenceConfirms = saved.silenceConfirms;
  return rules;
}

/** The rules in force: the admin's values, each falling back on its default. */
export async function groceriesInForce(db: Db): Promise<GroceriesRules> {
  const row = await db.platformSetting.findUnique({ where: { key: GROCERIES_KEY } });
  return readGroceries(
    (row?.value ?? {}) as Partial<Record<keyof GroceriesRules, unknown>>,
  );
}
