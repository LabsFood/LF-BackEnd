/** Prefix for all disposable demo data — used by seed-demo and unseed-demo. */
export const DEMO_SEED_TAG = 'demo_seed';

export const DEMO_COUNT = 10;

export const DEMO_MENU_YEAR = 2099;

export function demoClientClerkId(index: number): string {
  return `${DEMO_SEED_TAG}_client_${pad(index)}`;
}

export function demoChefClerkId(index: number): string {
  return `${DEMO_SEED_TAG}_chef_${pad(index)}`;
}

/** Reserved domain for demo users — Clerk rejects `.test` and other non-routable TLDs. */
export const DEMO_EMAIL_DOMAIN = 'example.com';

export function demoClientEmail(index: number): string {
  return `demo-seed-client-${pad(index)}@${DEMO_EMAIL_DOMAIN}`;
}

export function demoChefEmail(index: number): string {
  return `demo-seed-chef-${pad(index)}@${DEMO_EMAIL_DOMAIN}`;
}

/** Map legacy `@labsfood.test` demo emails to a Clerk-accepted address. */
export function normalizeEmailForClerk(email: string): string {
  return email.replace(/@labsfood\.test$/i, `@${DEMO_EMAIL_DOMAIN}`);
}

export function demoBookingReference(index: number): string {
  return `DEMO-SEED-${pad(index)}`;
}

export function demoQuoteReference(index: number): string {
  return `DEMO-QT-${pad(index)}`;
}

export function demoFormuleId(index: number): string {
  return `demo-seed-f${pad(index)}`;
}

export function demoCmsSlug(index: number): string {
  return `demo-seed-page-${pad(index)}`;
}

export function demoMealName(index: number): string {
  return `[demo] Meal ${pad(index)}`;
}

function pad(index: number): string {
  return String(index).padStart(2, '0');
}

/**
 * A single demo admin — the identity behind an admin force-settle on a CESU
 * declaration (`CesuSettlement.confirmedByUserId` + `adminOverride`).
 */
export function demoAdminClerkId(): string {
  return `${DEMO_SEED_TAG}_admin_01`;
}

export function demoAdminEmail(): string {
  return `demo-seed-admin@${DEMO_EMAIL_DOMAIN}`;
}

/**
 * Fake Stripe identifiers. They are shaped like the real ones so the UI renders them
 * normally, but they exist in no Stripe account — never replay them against the API.
 */
export function demoStripeAccountId(index: number): string {
  return `acct_demoseed${pad(index)}`;
}

export function demoStripeCustomerId(index: number): string {
  return `cus_demoseed${pad(index)}`;
}

export function demoStripeSetupIntentId(index: number): string {
  return `seti_demoseed${pad(index)}`;
}

export function demoStripePaymentMethodId(index: number): string {
  return `pm_demoseed${pad(index)}`;
}

export function demoStripeMandateId(index: number): string {
  return `mandate_demoseed${pad(index)}`;
}

export function demoPaymentIntentId(index: number): string {
  return `pi_demoseed${pad(index)}`;
}

export function demoChargeId(index: number): string {
  return `ch_demoseed${pad(index)}`;
}

/** PaymentIntent of a commission **debit** — a separate charge from the booking's. */
export function demoDebitIntentId(index: number): string {
  return `pi_demoseeddebit${pad(index)}`;
}

/**
 * Demo facture B numbers.
 *
 * Deliberately **not** the production `LF-COM-<year>-NNNN` scheme: demo invoices must
 * never be mistaken for real ones, and `nextInvoiceNumber` counts by the configured
 * prefix, so seeding into that sequence would make the next real invoice reuse a number.
 */
export const DEMO_INVOICE_PREFIX = 'DEMO-COM-';

export function demoCommissionInvoiceNumber(index: number): string {
  return `${DEMO_INVOICE_PREFIX}${pad(index)}`;
}

/** Prefix of every seeded `StripeEventLog` row. */
export const DEMO_STRIPE_EVENT_PREFIX = 'evt_demoseed';

export function demoStripeEventId(index: number): string {
  return `${DEMO_STRIPE_EVENT_PREFIX}${pad(index)}`;
}

/** CRCESU affiliation number (NAN) — the number a client adds the chef with. */
export function demoCrcesuNan(index: number): string {
  return `99000000${pad(index)}`;
}

/** NOVA declaration number, for a type A "service à la personne" chef. */
export function demoNovaCode(index: number): string {
  return `SAP99000000${pad(index)}`;
}
