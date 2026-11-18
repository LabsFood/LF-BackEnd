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
  sepaMandate: { select: { status: true } },
} as const;

export type ChefCesuInfoRow = {
  id: string;
  displayName: string;
  sapProfile: {
    acceptsCesu: boolean;
    crcesuNan: string | null;
    crcesuAffiliationStatus: SapExternalStatus;
  } | null;
  sepaMandate: { status: string } | null;
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
/**
 * Whether the commission can be debited from this chef (`sepa-mandates.service.ts`).
 * CESU and the immediate advance never cross Stripe, so their commission can only be
 * collected by direct debit: without an active mandate, neither is offered.
 */
export const mandateActive = (mandate: { status: string } | null | undefined) =>
  mandate?.status === 'active';

/** CESU is only offered with the NAN a client needs to add the chef on their portal. */
export const cesuAccepted = (
  sap: { acceptsCesu: boolean; crcesuNan: string | null } | null | undefined,
  mandate: { status: string } | null | undefined,
) => Boolean(sap?.acceptsCesu && sap.crcesuNan && mandateActive(mandate));

/** The chef's own SAP/NOVA number: every request to URSSAF is made in its name. */
export const novaCodeSet = (sap: { novaCode: string | null } | null | undefined) =>
  Boolean(sap?.novaCode?.trim());

/**
 * The immediate advance: URSSAF habilitation (flipped by an admin), the chef's NOVA
 * code (entered with each request on the intermediary's space), and a mandate for
 * the commission.
 */
export const advanceAccepted = (
  sap:
    { urssafTiersPrestationStatus: string; novaCode: string | null } | null | undefined,
  mandate: { status: string } | null | undefined,
) =>
  sap?.urssafTiersPrestationStatus === 'active' &&
  novaCodeSet(sap) &&
  mandateActive(mandate);

export function toChefCesuInfo(chef: ChefCesuInfoRow): ChefCesuInfo {
  const acceptsCesu = cesuAccepted(chef.sapProfile, chef.sepaMandate);
  return {
    chefProfileId: chef.id,
    chefDisplayName: chef.displayName,
    acceptsCesu,
    crcesuNan: acceptsCesu ? (chef.sapProfile?.crcesuNan ?? null) : null,
    crcesuAffiliationStatus: chef.sapProfile?.crcesuAffiliationStatus ?? 'not_started',
    supportedIssuers: [...CESU_SUPPORTED_ISSUERS],
  };
}
