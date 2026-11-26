import { DEFAULT_CESU_PLATFORM_NAME } from './cesu-collector';

/** Labs Food Batchcooking SAS as it appears on the documents it issues or receives. */
export interface SasIdentity {
  name: string;
  siren: string | null;
  address: string | null;
  /** Approved « services à la personne » declaration (SAP...). */
  sapDeclarationNumber: string | null;
}

export function sasIdentity(env: NodeJS.ProcessEnv = process.env): SasIdentity {
  return {
    name: env.CESU_PLATFORM_NAME?.trim() || DEFAULT_CESU_PLATFORM_NAME,
    siren: env.SAS_SIREN?.trim() || null,
    address: env.SAS_ADDRESS?.trim() || null,
    sapDeclarationNumber: env.SAP_DECLARATION_NUMBER?.trim() || null,
  };
}
