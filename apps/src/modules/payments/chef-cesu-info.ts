import type { CesuIssuer } from '../../generated/prisma/client';
import { cesuCollector } from './cesu-collector';
import { sasIdentity } from './sas-identity';

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
  sapProfile: { select: { acceptsCesu: true } },
  sepaMandate: { select: { status: true } },
} as const;

export type ChefCesuInfoRow = {
  id: string;
  displayName: string;
  sapProfile: { acceptsCesu: boolean } | null;
  sepaMandate: { status: string } | null;
};

export interface ChefCesuInfo {
  chefProfileId: string;
  chefDisplayName: string;
  acceptsCesu: boolean;
  /** The platform's NAN (`cesu-collector.ts`): the client never pays the batch cooker. */
  payeeNan: string | null;
  /** Who the client pays in CESU (the SAP structure). */
  payeeName: string | null;
  supportedIssuers: CesuIssuer[];
}

/**
 * Whether the commission can be debited from this chef (`sepa-mandates.service.ts`).
 * CESU and the immediate advance never cross Stripe, so their commission can only be
 * collected by direct debit: without an active mandate, neither is offered.
 */
export const mandateActive = (mandate: { status: string } | null | undefined) =>
  mandate?.status === 'active';

/**
 * CESU is paid to the platform's NAN, so it is offered only when that NAN is configured,
 * the batch cooker accepts the method, and the commission can still be collected.
 */
export const cesuAccepted = (
  sap: { acceptsCesu: boolean } | null | undefined,
  mandate: { status: string } | null | undefined,
) => Boolean(sap?.acceptsCesu && cesuCollector() && mandateActive(mandate));

/**
 * The SAS SAP declaration is configured: every immediate-advance request is made under
 * it, never under the chef's own NOVA (MajorD, 26/11/2026). The chef's NOVA is only
 * checked by the admin when vetting the dossier.
 */
export const sasSapSet = () => Boolean(sasIdentity().sapDeclarationNumber);

/**
 * The immediate advance: URSSAF habilitation (flipped by an admin once the chef's
 * dossier, NOVA included, is checked), the SAS SAP declaration the request is made
 * under, and a mandate for the commission.
 */
export const advanceAccepted = (
  sap: { urssafTiersPrestationStatus: string } | null | undefined,
  mandate: { status: string } | null | undefined,
) =>
  sap?.urssafTiersPrestationStatus === 'active' && sasSapSet() && mandateActive(mandate);

export function toChefCesuInfo(chef: ChefCesuInfoRow): ChefCesuInfo {
  const acceptsCesu = cesuAccepted(chef.sapProfile, chef.sepaMandate);
  const collector = acceptsCesu ? cesuCollector() : null;
  return {
    chefProfileId: chef.id,
    chefDisplayName: chef.displayName,
    acceptsCesu,
    payeeNan: collector?.nan ?? null,
    payeeName: collector?.name ?? null,
    supportedIssuers: [...CESU_SUPPORTED_ISSUERS],
  };
}

/** Prisma `select` for `offeredMethods`. */
export const OFFERED_METHODS_SELECT = {
  stripeAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  sapProfile: true,
  sepaMandate: { select: { status: true } },
} as const;

/**
 * Which methods a client can choose with this chef at booking (CGV V1 5.1). The card
 * needs a finished Stripe account; the advance an open URSSAF gateway (`urssaf.gateway`
 * not `disabled`).
 */
export const offeredMethods = (
  chef: {
    stripeAccountId: string | null;
    stripeChargesEnabled: boolean;
    stripePayoutsEnabled: boolean;
    sapProfile: Parameters<typeof advanceAccepted>[0] &
      Parameters<typeof cesuAccepted>[0];
    sepaMandate: { status: string } | null;
  },
  urssafMode: string,
) => ({
  cb: Boolean(
    chef.stripeAccountId && chef.stripeChargesEnabled && chef.stripePayoutsEnabled,
  ),
  avance_immediate:
    urssafMode !== 'disabled' && advanceAccepted(chef.sapProfile, chef.sepaMandate),
  cesu: cesuAccepted(chef.sapProfile, chef.sepaMandate),
});
