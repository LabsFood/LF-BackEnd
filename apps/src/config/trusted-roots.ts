import { X509Certificate } from 'node:crypto';
import { rootCertificates, setDefaultCACertificates } from 'node:tls';

/**
 * eMudhra (emSign) roots, distrusted after the eMudhra CA compromise (2026-10-31).
 * On that date no host the API calls (Supabase, Stripe, Clerk, Brevo, Google Maps,
 * Cloudflare R2) chained to one.
 */
const DISTRUSTED_ROOTS = /eMudhra|emSign/i;

/** Node's bundled root CAs, minus the distrusted ones. */
export const TRUSTED_ROOT_CERTIFICATES: string[] = rootCertificates.filter(
  (pem) => !DISTRUSTED_ROOTS.test(new X509Certificate(pem).subject),
);

/**
 * Makes every TLS connection this process opens afterwards (fetch, Stripe, Clerk,
 * Supabase storage, R2...) verify against TRUSTED_ROOT_CERTIFICATES. Call it before
 * the first connection. Returns how many bundled roots were dropped.
 */
export function distrustCompromisedRoots(): number {
  setDefaultCACertificates(TRUSTED_ROOT_CERTIFICATES);
  return rootCertificates.length - TRUSTED_ROOT_CERTIFICATES.length;
}
