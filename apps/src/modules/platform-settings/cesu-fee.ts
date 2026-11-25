import type { ChefTier } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * « Frais de traitement et d'encaissement des CESU », borne by the batch cooker on the
 * part of a booking paid in prefinanced CESU (MajorD, 25/11/2026). Never charged to the
 * client: CRCESU rules forbid any surcharge (CGA art. 4.1).
 *
 * Cascaded after the commission: on 150 € paid in CESU at 15 % commission and 10 %
 * fee, the commission is 22,50 €, the fee 10 % of the 127,50 € left (12,75 €), and the
 * batch cooker receives 114,75 €.
 *
 * An admin sets a default rate and, optionally, a rate per chef tier.
 */
export const CESU_FEE_KEY = 'cesu_fee';

export const DEFAULT_CESU_FEE_BPS = 1000;
/** A third of what is left at most: above that the setting is a typing mistake. */
export const MAX_CESU_FEE_BPS = 3000;

export const CHEF_TIER_CODES: readonly ChefTier[] = [
  'tier_1',
  'tier_2',
  'tier_3',
  'tier_4',
];

export interface CesuFeeRules {
  /** Applies to every tier without its own rate. */
  defaultBps: number;
  /** Only the tiers with their own rate. */
  byTier: Partial<Record<ChefTier, number>>;
}

type Db = Pick<PrismaService, 'platformSetting'>;

const validBps = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_CESU_FEE_BPS;

/** The rules in force: the admin's, with anything missing or invalid from the default. */
export async function cesuFeeRulesInForce(db: Db): Promise<CesuFeeRules> {
  const row = await db.platformSetting.findUnique({ where: { key: CESU_FEE_KEY } });
  return readCesuFeeRules(row?.value);
}

export function readCesuFeeRules(value: unknown): CesuFeeRules {
  const saved = (value ?? {}) as { defaultBps?: unknown; byTier?: unknown };
  const byTierSaved = (saved.byTier ?? {}) as Partial<Record<ChefTier, unknown>>;
  const byTier: Partial<Record<ChefTier, number>> = {};
  for (const tier of CHEF_TIER_CODES) {
    const bps = byTierSaved[tier];
    if (validBps(bps)) {
      byTier[tier] = bps;
    }
  }
  return {
    defaultBps: validBps(saved.defaultBps) ? saved.defaultBps : DEFAULT_CESU_FEE_BPS,
    byTier,
  };
}

/** The rate a batch cooker of this tier bears on what is paid in CESU. */
export const cesuFeeBpsFor = (rules: CesuFeeRules, tier: ChefTier): number =>
  rules.byTier[tier] ?? rules.defaultBps;

/**
 * The fee on one CESU amount, cascaded after the commission: computed on what is left
 * once the commission is taken. Rounded to the cent, half up.
 */
export function cesuFeeCents(
  amountCents: number,
  commissionCents: number,
  feeBps: number,
): number {
  const left = Math.max(0, amountCents - commissionCents);
  return Math.round((left * feeBps) / 10_000);
}
