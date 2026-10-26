import { UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { resolveAllowedOrigins } from '../../config/allowed-origins';

/**
 * Refuses a URL Stripe would send a user back to unless it is on one of our own sites
 * (the CORS origins). Without it, a hosted Stripe page becomes an open redirect.
 */
export function assertOwnSiteUrl(
  config: ConfigService,
  url: string,
  message: string,
): void {
  const allowed = config.get<string[]>('cors.origins', resolveAllowedOrigins());
  let origin: string | null = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }
  if (!origin || !allowed.includes(origin)) {
    throw new UnprocessableEntityException({ code: 'RETURN_URL_NOT_ALLOWED', message });
  }
}
