import type { Prisma } from '../../generated/prisma/client';

/**
 * The batch cooker's legal identity, as the client reads it before booking (CGV
 * art. 3.2) and in the contract email and documents. Shown as far as it is filled:
 * `missing` names the gaps for the admin and the chef, never blocks (2026-11-11).
 */

export const CHEF_LEGAL_STATUSES = [
  'micro_entreprise',
  'ei',
  'eurl',
  'sarl',
  'sasu',
  'sas',
] as const;
export type ChefLegalStatus = (typeof CHEF_LEGAL_STATUSES)[number];

const STATUS_LABEL: Record<ChefLegalStatus, string> = {
  micro_entreprise: 'Entrepreneur individuel (micro-entreprise)',
  ei: 'Entrepreneur individuel',
  eurl: 'EURL',
  sarl: 'SARL',
  sasu: 'SASU',
  sas: 'SAS',
};

/** `franchise`: VAT-exempt small business (art. 293 B du CGI). */
export const VAT_REGIMES = ['franchise', 'subject'] as const;
export type VatRegime = (typeof VAT_REGIMES)[number];

/** The batch cooker is reached through the platform, never directly (CGV art. 3.2). */
const CONTACT = 'Par la messagerie de Lab’s Food';

export const CHEF_LEGAL_SELECT = {
  legalName: true,
  legalStatus: true,
  siren: true,
  businessAddress: true,
  vatRegime: true,
  vatNumber: true,
  insurerName: true,
  insuranceCoverage: true,
  mediatorName: true,
  mediatorUrl: true,
  sapDeclarationNumber: true,
  sapProfile: { select: { novaCode: true } },
} satisfies Prisma.ChefProfileSelect;

export type ChefLegalRow = Prisma.ChefProfileGetPayload<{
  select: typeof CHEF_LEGAL_SELECT;
}>;

export type ChefLegalGap =
  'name' | 'legalStatus' | 'siren' | 'businessAddress' | 'vat' | 'insurance' | 'mediator';

export interface ChefLegalIdentity {
  name: string | null;
  legalStatus: string | null;
  siren: string | null;
  businessAddress: string | null;
  /** « TVA non applicable, article 293 B du CGI », or the VAT number. */
  vat: string | null;
  /** The SAP declaration number, when there is one: not a gap without. */
  sapNumber: string | null;
  insurance: { insurer: string; coverage: string } | null;
  mediator: { name: string; url: string } | null;
  contact: string;
  missing: ChefLegalGap[];
}

function vatLabel(regime: string | null, number: string | null): string | null {
  if (regime === 'franchise') return 'TVA non applicable, article 293 B du CGI';
  if (regime === 'subject' && number) return `TVA intracommunautaire ${number}`;
  return null;
}

export function chefLegalIdentity(row: ChefLegalRow): ChefLegalIdentity {
  const identity: Omit<ChefLegalIdentity, 'missing'> = {
    name: row.legalName ?? null,
    legalStatus: row.legalStatus
      ? (STATUS_LABEL[row.legalStatus as ChefLegalStatus] ?? null)
      : null,
    siren: row.siren ?? null,
    businessAddress: row.businessAddress ?? null,
    vat: vatLabel(row.vatRegime, row.vatNumber),
    sapNumber: row.sapDeclarationNumber ?? row.sapProfile?.novaCode ?? null,
    insurance:
      row.insurerName && row.insuranceCoverage
        ? { insurer: row.insurerName, coverage: row.insuranceCoverage }
        : null,
    mediator:
      row.mediatorName && row.mediatorUrl
        ? { name: row.mediatorName, url: row.mediatorUrl }
        : null,
    contact: CONTACT,
  };
  const required: ChefLegalGap[] = [
    'name',
    'legalStatus',
    'siren',
    'businessAddress',
    'vat',
    'insurance',
    'mediator',
  ];
  return { ...identity, missing: required.filter((key) => identity[key] === null) };
}

/** What a client sees: the identity without the list of gaps. */
export function publicChefLegalIdentity(
  row: ChefLegalRow,
): Omit<ChefLegalIdentity, 'missing'> {
  const { missing: _missing, ...identity } = chefLegalIdentity(row);
  return identity;
}

/** The identity as lines of text, for the contract email and documents. */
export function legalIdentityLines(
  identity: Omit<ChefLegalIdentity, 'missing'>,
  displayName: string,
): string[] {
  return [
    identity.name ?? displayName,
    identity.legalStatus,
    identity.siren && `SIREN ${identity.siren}`,
    identity.businessAddress,
    identity.vat,
    identity.sapNumber &&
      `Déclaration de services à la personne n° ${identity.sapNumber}`,
    identity.insurance &&
      `Assurance professionnelle : ${identity.insurance.insurer}, ${identity.insurance.coverage}`,
    identity.mediator &&
      `Médiateur de la consommation : ${identity.mediator.name} (${identity.mediator.url})`,
    `Contact : ${identity.contact.charAt(0).toLowerCase()}${identity.contact.slice(1)}`,
  ].filter((line): line is string => Boolean(line));
}
