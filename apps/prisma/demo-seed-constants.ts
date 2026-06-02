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

export function demoClientEmail(index: number): string {
  return `demo-seed-client-${pad(index)}@labsfood.test`;
}

export function demoChefEmail(index: number): string {
  return `demo-seed-chef-${pad(index)}@labsfood.test`;
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
