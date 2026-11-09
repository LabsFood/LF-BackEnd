import { ChefTier, Prisma } from '../../generated/prisma/client';

export const CHEF_TIERS_KEY = 'chef_tiers';

/** Neutral until product names the tiers (Recettes R34): only the labels change. */
export const DEFAULT_CHEF_TIER_LABELS: Record<ChefTier, string> = {
  tier_1: 'Palier 1',
  tier_2: 'Palier 2',
  tier_3: 'Palier 3',
  tier_4: 'Palier 4',
};

/** The labels in force: the saved ones, any missing or blank one from the defaults. */
export async function chefTierLabels(
  db: Pick<Prisma.TransactionClient, 'platformSetting'>,
): Promise<Record<ChefTier, string>> {
  const row = await db.platformSetting.findUnique({ where: { key: CHEF_TIERS_KEY } });
  const saved = (row?.value ?? {}) as Partial<Record<ChefTier, unknown>>;
  const label = (tier: ChefTier) => {
    const value = saved[tier];
    return typeof value === 'string' && value.trim() !== ''
      ? value
      : DEFAULT_CHEF_TIER_LABELS[tier];
  };
  return {
    tier_1: label('tier_1'),
    tier_2: label('tier_2'),
    tier_3: label('tier_3'),
    tier_4: label('tier_4'),
  };
}
