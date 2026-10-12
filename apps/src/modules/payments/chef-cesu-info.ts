import type { CesuIssuer, SapExternalStatus } from '../../generated/prisma/client';

/**
 * Every issuer a French beneficiary can hold a prefinanced CESU account with. Purely
 * informational: none of them is queryable, and `domiserve` runs its own circuit outside
 * the CRCESU.
 */
export const CESU_SUPPORTED_ISSUERS: readonly CesuIssuer[] = [
  'pluxee',
  'edenred',
  'up',
  'bimpli',
  'domiserve',
  'other',
];

/** Prisma `select` for the chef fields a client needs before paying in CESU. */
export const CHEF_CESU_INFO_SELECT = {
  id: true,
  displayName: true,
  sapProfile: {
    select: {
      acceptsCesu: true,
      crcesuNan: true,
      crcesuAffiliationStatus: true,
    },
  },
} as const;

export type ChefCesuInfoRow = {
  id: string;
  displayName: string;
  sapProfile: {
    acceptsCesu: boolean;
    crcesuNan: string | null;
    crcesuAffiliationStatus: SapExternalStatus;
  } | null;
};

export interface ChefCesuInfo {
  chefProfileId: string;
  chefDisplayName: string;
  acceptsCesu: boolean;
  crcesuNan: string | null;
  crcesuAffiliationStatus: SapExternalStatus;
  supportedIssuers: CesuIssuer[];
}

/**
 * The chef's CESU coordinates as a client sees them.
 *
 * A client pays from their issuer's beneficiary area, and to do that they must first add
 * the chef as an intervenant using this NAN — **before** any payment exists. Invoice A
 * cannot be the carrier: it is only issued once the service has been delivered. That is
 * why the number is published on the public chef profile, on the booking, and on the
 * quote, all through this one mapper.
 *
 * The number is only published for a chef who has opted in: without the opt-in it is not
 * actionable, and publishing it would invite a payment the chef will refuse.
 */
export function toChefCesuInfo(chef: ChefCesuInfoRow): ChefCesuInfo {
  const acceptsCesu = Boolean(chef.sapProfile?.acceptsCesu && chef.sapProfile.crcesuNan);
  return {
    chefProfileId: chef.id,
    chefDisplayName: chef.displayName,
    acceptsCesu,
    crcesuNan: acceptsCesu ? (chef.sapProfile?.crcesuNan ?? null) : null,
    crcesuAffiliationStatus: chef.sapProfile?.crcesuAffiliationStatus ?? 'not_started',
    supportedIssuers: [...CESU_SUPPORTED_ISSUERS],
  };
}
