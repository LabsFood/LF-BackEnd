import { ChefTier, Prisma } from '../../generated/prisma/client';

export const CHEF_TIERS_KEY = 'chef_tiers';

/** Neutral until product names the tiers (Recettes R34): only the labels change. */
export const DEFAULT_CHEF_TIER_LABELS: Record<ChefTier, string> = {
  tier_1: 'Palier 1',
  tier_2: 'Palier 2',
  tier_3: 'Palier 3',
  tier_4: 'Palier 4',
};

/** What a verified batch cooker can do. The label is what the console shows. */
export const CHEF_CAPABILITIES = [
  { code: 'publish_dishes', label: 'Écrire et publier ses plats' },
  { code: 'publish_menus', label: 'Composer et publier ses menus' },
  { code: 'showcase_weeks', label: 'Choisir le menu de chaque semaine en vitrine' },
  { code: 'adopt_labsfood_content', label: 'Adopter les plats et menus de Lab’s Food' },
  { code: 'duplicate_content', label: 'Dupliquer un plat ou un menu' },
  { code: 'service_offers', label: 'Fixer ses formules et ses tarifs' },
  { code: 'receive_bookings', label: 'Recevoir des réservations' },
  { code: 'answer_quotes', label: 'Répondre aux demandes sur mesure' },
] as const;

/**
 * BLK-26, decided 2026-11-10: every batch cooker is tier 1, with every capability,
 * at the platform commission. Tiers 2 to 4 are not decided (`decided: false`): they
 * restrict nothing and pay the same rate, so the console shows them as provisional.
 *
 * ponytail: one commission for every tier, read from `commission_bps`. A per-tier
 * rate goes into pricing (domain/pricing.ts) once product sets the tier grid.
 */
export const DECIDED_CHEF_TIERS: readonly ChefTier[] = ['tier_1'];

export function chefTierRules(commissionBps: number) {
  const rule = (tier: ChefTier) => ({
    decided: DECIDED_CHEF_TIERS.includes(tier),
    commissionBps,
    capabilities: CHEF_CAPABILITIES,
  });
  return {
    tier_1: rule('tier_1'),
    tier_2: rule('tier_2'),
    tier_3: rule('tier_3'),
    tier_4: rule('tier_4'),
  };
}

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
