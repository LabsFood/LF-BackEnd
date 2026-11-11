import {
  ChefApplication,
  ChefApplicationStatus,
  ChefDocumentStatus,
  ChefDocumentType,
  CompanyLegalForm,
  WorkAuthorizationStatus,
} from '../../../generated/prisma/client';
import { Commune, communeKey } from '../../../common/commune.rules';

/**
 * Pure rules behind FLOW-01. No database, no I/O — everything here is a function of
 * the candidate's answers and the documents on file, so the tables in §2 and §5.3 of
 * the flow can be checked directly against the tests next to this file.
 */

/**
 * Wire values are kebab-case (`status-proof`), Postgres enums are snake_case
 * (`status_proof`). The mapping is total and mechanical across all four enums —
 * document type, work authorisation, legal form and SAP path — so it is a pair of
 * string substitutions rather than four lookup tables that could drift.
 */
export const toWire = <T extends string>(value: T): string => value.replace(/_/g, '-');
export const fromWire = (value: string): string => value.replace(/-/g, '_');

/** Only `blocking` documents gate approval (FLOW-01 §2). */
export type DocumentFamily = 'blocking' | 'conditional' | 'recommended';

/**
 * Family is a fixed property of the document type, so it lives here rather than as a
 * column that every row would have to repeat and keep consistent.
 */
export const DOCUMENT_FAMILY: Record<ChefDocumentType, DocumentFamily> = {
  identity: 'blocking',
  registration: 'blocking',
  residence_permit: 'conditional',
  renewal_receipt: 'conditional',
  status_proof: 'conditional',
  sap_declaration: 'conditional',
  sap_cooperative: 'conditional',
  rc_pro: 'recommended',
  haccp: 'recommended',
  ddpp: 'recommended',
  vigilance: 'recommended',
  // Not part of the vetting: it never gates approval, it sits in the dossier as proof.
  sepa_mandate: 'recommended',
};

/**
 * Every document type as the API accepts it (kebab-case), in family order: blocking,
 * then conditional, then recommended. This is the `{type}` enum in Swagger.
 */
export const DOCUMENT_TYPES: string[] = Object.keys(DOCUMENT_FAMILY).map(toWire);

/** French labels shown to the candidate; the API stores only the key. */
export const DOCUMENT_LABEL: Record<ChefDocumentType, string> = {
  identity: "Pièce d'identité",
  residence_permit: 'Titre de séjour',
  renewal_receipt: 'Récépissé de renouvellement de titre de séjour',
  status_proof: 'Justificatif de situation',
  registration: "Justificatif d'immatriculation",
  sap_declaration: 'Récépissé de déclaration SAP',
  sap_cooperative: "Attestation d'adhésion à une coopérative SAP",
  rc_pro: 'Assurance responsabilité civile professionnelle',
  haccp: 'Formation hygiène alimentaire (HACCP)',
  ddpp: 'Récépissé de déclaration DDPP',
  vigilance: 'Attestation de vigilance URSSAF',
  sepa_mandate: 'Mandat de prélèvement SEPA (commissions Lab’s Food)',
};

/**
 * Documents the API writes itself and a chef can only read. The mandate is proof of a
 * signature Stripe collected: an uploaded file of the same type would be a forgery.
 */
export const SYSTEM_DOCUMENT_TYPES: ReadonlySet<ChefDocumentType> = new Set([
  ChefDocumentType.sepa_mandate,
]);

/** Documents that lapse, and therefore need `expiresOn` at confirm (FLOW-01 §3.3). */
export const EXPIRING_DOCUMENT_TYPES: ReadonlySet<ChefDocumentType> = new Set([
  ChefDocumentType.identity,
  ChefDocumentType.residence_permit,
  ChefDocumentType.renewal_receipt,
  ChefDocumentType.sap_declaration,
  ChefDocumentType.rc_pro,
  ChefDocumentType.haccp,
  ChefDocumentType.vigilance,
]);

/** Days before `expiresOn` at which the chef is warned (FLOW-01 §7). */
export const EXPIRY_NOTICE_DAYS = [60, 30, 7] as const;

/**
 * The notice a document with `daysLeft` remaining has just crossed — the
 * **tightest** applicable one, so 29 days out sends the 30-day warning and not
 * the 60-day one again. Returns `undefined` while the document is further out
 * than the widest threshold.
 */
export function expiryNoticeThreshold(daysLeft: number): number | undefined {
  let chosen: number | undefined;
  for (const threshold of EXPIRY_NOTICE_DAYS) {
    if (daysLeft <= threshold) chosen = threshold;
  }
  return chosen;
}

/** Extra proof demanded by a non-EU work authorisation (FLOW-01 §2). */
const WORK_AUTHORIZATION_DOCUMENT: Partial<
  Record<WorkAuthorizationStatus, ChefDocumentType>
> = {
  residence_permit: ChefDocumentType.residence_permit,
  renewal_pending: ChefDocumentType.renewal_receipt,
  other: ChefDocumentType.status_proof,
  // eu_citizen adds nothing: the identity document already covers it.
};

export interface ApplicationAnswers {
  workAuthorizationStatus: WorkAuthorizationStatus;
  companyLegalForm: CompanyLegalForm;
  sapPath: 'type_a' | 'type_b';
}

const sapProof = (answers: ApplicationAnswers): ChefDocumentType =>
  answers.sapPath === 'type_a'
    ? ChefDocumentType.sap_declaration
    : ChefDocumentType.sap_cooperative;

export interface DocumentRequirement {
  type: ChefDocumentType;
  label: string;
  family: DocumentFamily;
  /** True only for `blocking` documents — the ones that actually gate approval. */
  required: boolean;
}

/**
 * The document list for a candidature, derived from their answers (FLOW-01 §2).
 *
 * Computed here rather than sent by the client: while the frontend owned this list,
 * "required" was a suggestion no server enforced.
 */
export function requiredDocuments(answers: ApplicationAnswers): DocumentRequirement[] {
  const types: ChefDocumentType[] = [ChefDocumentType.identity];

  const workAuthDoc = WORK_AUTHORIZATION_DOCUMENT[answers.workAuthorizationStatus];
  if (workAuthDoc) types.push(workAuthDoc);

  // Someone with no company yet cannot produce a registration certificate. The
  // dossier still cannot be validated — it lands in `awaiting-registration` instead.
  if (answers.companyLegalForm !== CompanyLegalForm.not_registered) {
    types.push(ChefDocumentType.registration);
  }

  // Lab's Food is not a cooperative: the candidate proves their own declaration, or
  // the cooperative that holds one for them.
  types.push(sapProof(answers));

  types.push(ChefDocumentType.rc_pro, ChefDocumentType.haccp, ChefDocumentType.ddpp);

  return types.map((type) => ({
    type,
    label: DOCUMENT_LABEL[type],
    family: DOCUMENT_FAMILY[type],
    required: DOCUMENT_FAMILY[type] === 'blocking',
  }));
}

export type DossierStatus =
  | 'draft'
  | 'awaiting_registration'
  | 'incomplete'
  | 'reviewing'
  | 'validated'
  | 'suspended'
  | 'disabled';

/** The latest version of one document type, as `deriveDossierStatus` needs it. */
export interface DossierDocument {
  type: ChefDocumentType;
  status: ChefDocumentStatus;
}

const AWAITING_DECISION: ReadonlySet<ChefDocumentStatus> = new Set([
  ChefDocumentStatus.submitted,
  ChefDocumentStatus.reviewing,
]);

/** `expiring` still counts as valid — the document has not lapsed yet. */
const COUNTS_AS_VALID: ReadonlySet<ChefDocumentStatus> = new Set([
  ChefDocumentStatus.valid,
  ChefDocumentStatus.expiring,
]);

/**
 * The dossier state (FLOW-01 §5.3). Always derived, never stored: an admin cannot
 * type a dossier into `validated`, it follows from the documents.
 *
 * `documents` holds the **latest version per type**; older versions are history and
 * must not influence the current state.
 */
export function deriveDossierStatus(
  documents: DossierDocument[],
  context: { answers: ApplicationAnswers; disabled?: boolean },
): DossierStatus {
  if (context.disabled) return 'disabled';

  const latest = new Map(documents.map((doc) => [doc.type, doc.status]));
  const blocking = requiredDocuments(context.answers)
    .filter((req) => req.family === 'blocking')
    .map((req) => req.type);

  // An expired blocking document pulls the whole dossier down, whatever else is on
  // file — this is the only state the system enters without a human deciding it.
  if (blocking.some((type) => latest.get(type) === ChefDocumentStatus.expired)) {
    return 'suspended';
  }

  if (documents.length === 0) return 'draft';

  const isMissingOrRejected = (type: ChefDocumentType): boolean => {
    const status = latest.get(type);
    return status === undefined || status === ChefDocumentStatus.rejected;
  };

  if (blocking.some(isMissingOrRejected)) return 'incomplete';
  if (blocking.some((type) => AWAITING_DECISION.has(latest.get(type)!))) {
    return 'reviewing';
  }

  if (blocking.every((type) => COUNTS_AS_VALID.has(latest.get(type)!))) {
    // Everything on file is good, but there is no company to attach the activity to.
    return context.answers.companyLegalForm === CompanyLegalForm.not_registered
      ? 'awaiting_registration'
      : 'validated';
  }

  return 'incomplete';
}

/** Approval is refused unless the dossier derived itself into `validated`. */
export function canApprove(status: DossierStatus): boolean {
  return status === 'validated';
}

/**
 * Taken offline by an admin — the dossier reads `disabled`.
 *
 * A candidate awaiting approval is also inactive with no suspension episode, but is
 * not disabled: their dossier is still being built. Only a verified chef can be.
 */
export function isDisabledByAdmin(profile: {
  isVerified: boolean;
  isActive: boolean;
  autoSuspendedAt: Date | null;
}): boolean {
  return profile.isVerified && !profile.isActive && profile.autoSuspendedAt === null;
}

/** Awaiting a decision: an admin can still decide, the candidate can still correct. */
export const UNDECIDED: ChefApplicationStatus[] = [
  ChefApplicationStatus.submitted,
  ChefApplicationStatus.changes_requested,
];

/**
 * The document that proves one answer, read off the answers the same way
 * {@link requiredDocuments} reads them. Phone, address and zones are proved by none.
 */
function proofOf(
  column: keyof ChefApplication,
  answers: ApplicationAnswers,
): ChefDocumentType | undefined {
  switch (column) {
    case 'firstName':
    case 'lastName':
      return ChefDocumentType.identity;
    case 'workAuthorizationStatus':
    case 'workAuthorizationDetails':
      // An EU citizen's right to work is read off the identity document itself.
      return (
        WORK_AUTHORIZATION_DOCUMENT[answers.workAuthorizationStatus] ??
        ChefDocumentType.identity
      );
    case 'companyLegalForm':
    case 'companySiret':
      return answers.companyLegalForm === CompanyLegalForm.not_registered
        ? undefined
        : ChefDocumentType.registration;
    case 'sapPath':
      return sapProof(answers);
    case 'sapDeclarationNumber':
      return answers.sapPath === 'type_a' ? ChefDocumentType.sap_declaration : undefined;
    default:
      return undefined;
  }
}

/**
 * The validated documents a correction to the candidature would contradict, each
 * proving an answer in `changed` (candidature columns). An admin validated that
 * document against the answer as it stood, so the change is refused rather than left
 * behind a decision it no longer matches. A new version of the document lifts the
 * lock, as does its refusal, and is reviewed against the new answer.
 *
 * `answers` are the stored ones: they decide which document proves what.
 */
export function lockingDocuments(
  changed: readonly (keyof ChefApplication)[],
  answers: ApplicationAnswers,
  latest: ReadonlyMap<ChefDocumentType, { status: ChefDocumentStatus }>,
): ChefDocumentType[] {
  const locking = new Set<ChefDocumentType>();
  for (const column of changed) {
    const proof = proofOf(column, answers);
    const status = proof && latest.get(proof)?.status;
    if (proof && status && COUNTS_AS_VALID.has(status)) locking.add(proof);
  }
  return [...locking];
}

// ------------------------------------------------------------------ validation

/**
 * SIRET: 14 digits passing the Luhn checksum (FLOW-01 §2).
 *
 * Form only. Whether the establishment actually exists is an INSEE Sirene lookup,
 * deliberately out of scope — it changes the refusal rate, not the flow.
 */
export function isValidSiret(siret: string): boolean {
  return /^\d{14}$/.test(siret) && passesLuhn(siret);
}

/** SIREN: the SIRET without its establishment number, 9 digits passing Luhn. */
export function isValidSiren(siren: string): boolean {
  return /^\d{9}$/.test(siren) && passesLuhn(siren);
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    // Rightmost digit is never doubled; every second digit leftward is.
    const doubled = (digits.length - i) % 2 === 0;
    let digit = Number(digits[i]) * (doubled ? 2 : 1);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Metropolitan France including Corsica: 01000–95999 (FLOW-01 §2). */
export function isValidPostcode(postcode: string): boolean {
  if (!/^\d{5}$/.test(postcode)) return false;
  const department = Number(postcode.slice(0, 2));
  return department >= 1 && department <= 95;
}

/** `SAP` followed by 9 digits (FLOW-01 §2). */
export function isValidSapDeclarationNumber(value: string): boolean {
  return /^SAP\d{9}$/.test(value);
}

/**
 * Metropolitan regions, INSEE codes (FLOW-01 §9.4).
 *
 * A constant, not a table: it changes when France reorganises its regions, which
 * is not a release cadence worth a migration. Served publicly so the frontend can
 * drop its hard-coded copy.
 */
export const METROPOLITAN_REGIONS = [
  { code: '11', label: 'Île-de-France' },
  { code: '24', label: 'Centre-Val de Loire' },
  { code: '27', label: 'Bourgogne-Franche-Comté' },
  { code: '28', label: 'Normandie' },
  { code: '32', label: 'Hauts-de-France' },
  { code: '44', label: 'Grand Est' },
  { code: '52', label: 'Pays de la Loire' },
  { code: '53', label: 'Bretagne' },
  { code: '75', label: 'Nouvelle-Aquitaine' },
  { code: '76', label: 'Occitanie' },
  { code: '84', label: 'Auvergne-Rhône-Alpes' },
  { code: '93', label: "Provence-Alpes-Côte d'Azur" },
  { code: '94', label: 'Corse' },
] as const;

const REGION_CODES: ReadonlySet<string> = new Set(
  METROPOLITAN_REGIONS.map((r) => r.code),
);

export function isMetropolitanRegion(code: string): boolean {
  return REGION_CODES.has(code);
}

/**
 * What is wrong with a set of intervention zones, or `undefined`. Shared by the
 * candidature and the admin change after approval, so both refuse the same zones.
 */
export function interventionZonesProblem(
  zones: readonly { regionCode: string; scope: string; cities: readonly unknown[] }[],
): string | undefined {
  for (const zone of zones) {
    if (!isMetropolitanRegion(zone.regionCode)) {
      return `interventionZones: "${zone.regionCode}" is not a metropolitan region code.`;
    }
    if (zone.scope === 'cities' && zone.cities.length === 0) {
      return `interventionZones[${zone.regionCode}] with scope "cities" needs at least one city.`;
    }
  }
  return undefined;
}

/**
 * What is wrong with a zone's towns against the communes of its region, or
 * `undefined`. Each town must be the commune its INSEE code names, in its department:
 * a town from another region, or a name or department that does not go with the code,
 * is refused.
 */
export function zoneCitiesProblem(
  zone: {
    regionCode: string;
    cities: readonly { name: string; dept: string; insee: string }[];
  },
  regionCommunes: readonly Commune[],
): string | undefined {
  const byCode = new Map(regionCommunes.map((commune) => [commune.code, commune]));
  for (const city of zone.cities) {
    const commune = byCode.get(city.insee);
    if (
      !commune ||
      commune.codeDepartement !== city.dept ||
      communeKey(commune.nom) !== communeKey(city.name)
    ) {
      return `interventionZones[${zone.regionCode}]: "${city.name}" (${city.insee}) is not a commune of this region.`;
    }
  }
  return undefined;
}

/** `APP-2026-0042` (FLOW-01 §2). Sequence is per calendar year. */
export function buildApplicationReference(year: number, sequence: number): string {
  return `APP-${year}-${String(sequence).padStart(4, '0')}`;
}
