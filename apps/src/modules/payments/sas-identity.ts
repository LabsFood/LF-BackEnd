/**
 * The trade name, shown everywhere: on screens, e-mails, invoices. Always with its
 * apostrophe (MajorD, 26/11/2026). Never the legal name in its place.
 */
export const TRADE_NAME = 'Lab’s Food';

/** The company behind the trade name, as registered: only for the legal mentions. */
export const DEFAULT_SAS_LEGAL_NAME = 'Labs Food Batchcooking SAS';

/** Lab's Food as it appears on the documents it issues or receives. */
export interface SasIdentity {
  /** « Lab’s Food ». */
  name: string;
  /** The registered company, printed in the legal mention only. */
  legalName: string;
  siren: string | null;
  address: string | null;
  /** Approved « services à la personne » declaration (SAP...). */
  sapDeclarationNumber: string | null;
}

export function sasIdentity(env: NodeJS.ProcessEnv = process.env): SasIdentity {
  return {
    name: TRADE_NAME,
    legalName: env.SAS_LEGAL_NAME?.trim() || DEFAULT_SAS_LEGAL_NAME,
    siren: env.SAS_SIREN?.trim() || null,
    address: env.SAS_ADDRESS?.trim() || null,
    sapDeclarationNumber: env.SAP_DECLARATION_NUMBER?.trim() || null,
  };
}

/** « Lab’s Food est le nom commercial de … » — the one place the legal name appears. */
export function legalNameMention(identity: SasIdentity): string {
  return (
    `${identity.name} est le nom commercial de ${identity.legalName}` +
    (identity.siren ? `, SIREN ${identity.siren}` : '') +
    (identity.address ? `, ${identity.address}` : '') +
    '.'
  );
}
