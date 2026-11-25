/**
 * Who collects prefinanced CESU: the SAP structure that invoices the household
 * (Labs Food Batchcooking SAS), on its own CRCESU affiliation. Batch cookers no longer
 * hold or publish a NAN: every client pays the same number, with their booking reference.
 *
 * Read from the environment at call time (validated by `env.validation.ts`), so the pure
 * helpers in `chef-cesu-info.ts` can use it without a ConfigService.
 */
export const DEFAULT_CESU_PLATFORM_NAME = 'Labs Food Batchcooking SAS';

export interface CesuCollector {
  /** The NAN the client enters on their issuer's portal. */
  nan: string;
  /** Who the client pays, shown beside the NAN. */
  name: string;
}

/** Null when no NAN is configured: CESU is then not offered at all. */
export function cesuCollector(
  env: NodeJS.ProcessEnv = process.env,
): CesuCollector | null {
  const nan = env.CESU_PLATFORM_NAN?.trim();
  if (!nan) {
    return null;
  }
  return { nan, name: env.CESU_PLATFORM_NAME?.trim() || DEFAULT_CESU_PLATFORM_NAME };
}
