import type { Prisma } from '../../../generated/prisma/client';
import { afterTaxCredit } from '../../quotes/domain/quote.rules';

/** The adults an offer's price covers, and what each adult or extra dish costs. */
export interface SupplementRules {
  includedPersons: number;
  extraPersonCents: number;
  extraMealCents: number;
}

/** The public pricing page: 3 adults in the price, then 15 € an adult and 8 € an extra dish. */
export const DEFAULT_SUPPLEMENT_RULES: SupplementRules = {
  includedPersons: 3,
  extraPersonCents: 1500,
  extraMealCents: 800,
};

/** `platform_settings` key; an admin changes it without a deploy. */
export const SUPPLEMENTS_KEY = 'booking_supplements';

/** The rules in force: the saved ones, any missing or malformed field from the defaults. */
export async function supplementRulesInForce(
  db: Pick<Prisma.TransactionClient, 'platformSetting'>,
): Promise<SupplementRules> {
  const row = await db.platformSetting.findUnique({ where: { key: SUPPLEMENTS_KEY } });
  const saved = (row?.value ?? {}) as Partial<Record<keyof SupplementRules, unknown>>;
  const pick = (key: keyof SupplementRules) => {
    const value = saved[key];
    return Number.isInteger(value) && (value as number) >= 0
      ? (value as number)
      : DEFAULT_SUPPLEMENT_RULES[key];
  };
  return {
    includedPersons: pick('includedPersons'),
    extraPersonCents: pick('extraPersonCents'),
    extraMealCents: pick('extraMealCents'),
  };
}

/** The lines added to a booking's price, each shown apart. */
export interface Supplements {
  extraPersonsCents: number;
  extraMealsCents: number;
  shoppingFeeCents: number;
}

/**
 * The shopping fee a booking carries: the offer's, when its chef does the shopping
 * and the client has not taken it on.
 */
export const shoppingFee = (
  offer: { shoppingIncluded: boolean; shoppingFeeCents: number },
  shoppingByClient: boolean,
) => (offer.shoppingIncluded && !shoppingByClient ? offer.shoppingFeeCents : 0);

/**
 * Adults beyond those included, the extra dishes the client asked for (the
 * "Plats supp." counter), and the shopping. A formule is a package: it takes the
 * shopping only.
 */
export function supplementsFor(
  input: {
    persons: number | null | undefined;
    extraMeals: number;
    shoppingFeeCents: number;
    formule: boolean;
  },
  rules: SupplementRules,
): Supplements {
  if (input.formule) {
    return {
      extraPersonsCents: 0,
      extraMealsCents: 0,
      shoppingFeeCents: input.shoppingFeeCents,
    };
  }
  return {
    extraPersonsCents:
      Math.max(0, (input.persons ?? 0) - rules.includedPersons) * rules.extraPersonCents,
    extraMealsCents: Math.max(0, input.extraMeals) * rules.extraMealCents,
    shoppingFeeCents: input.shoppingFeeCents,
  };
}

export const supplementsTotal = (s: Supplements) =>
  s.extraPersonsCents + s.extraMealsCents + s.shoppingFeeCents;

/**
 * A new booking's amounts. All of it is the service, so all of it takes the tax
 * credit; a formule keeps its own after-credit price for its part.
 */
export function bookingAmounts(
  priceCents: number,
  supplements: Supplements,
  formuleAfterTaxCents?: number,
) {
  const extra = supplementsTotal(supplements);
  const amountTtc = priceCents + extra;
  return {
    priceCents,
    ...supplements,
    amountTtc,
    amountAfterTax:
      formuleAfterTaxCents === undefined
        ? afterTaxCredit(amountTtc)
        : formuleAfterTaxCents + afterTaxCredit(extra),
  };
}

/**
 * Swaps a booking's supplements for new ones: the base price stays as booked, and
 * an amount an admin set moves by the same difference rather than being reset.
 */
export function reprice(
  booking: Supplements & {
    priceCents: number;
    amountTtc: number | null;
    amountAfterTax: number | null;
  },
  next: Supplements,
) {
  const before = booking.amountTtc ?? booking.priceCents;
  const was = supplementsTotal(booking);
  const now = supplementsTotal(next);
  return {
    ...next,
    amountTtc: before - was + now,
    amountAfterTax:
      (booking.amountAfterTax ?? afterTaxCredit(before)) -
      afterTaxCredit(was) +
      afterTaxCredit(now),
  };
}
