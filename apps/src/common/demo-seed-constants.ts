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

export function demoMealName(index: number): string {
  return `[demo] Meal ${pad(index)}`;
}

function pad(index: number): string {
  return String(index).padStart(2, '0');
}
