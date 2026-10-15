import type { Prisma } from '../../generated/prisma/client';
import {
  type CommissionBreakdown,
  type CommissionRates,
  computeCommission,
} from './commission.util';

const BPS = 10_000;

/** Same key as `PlatformSettingsService`: the rate an admin sets from the console. */
const COMMISSION_KEY = 'commission_bps';

export type CommissionPolicyDb = Pick<
  Prisma.TransactionClient,
  'quote' | 'platformSetting'
>;

/**
 * The commission on one payment of a booking.
 *
 * **A prestation born from an accepted offer keeps the deal of that offer.** The batch
 * cooker priced it in net and the client accepted a price: the commission is the
 * difference between the two, frozen on the offer, whatever the rate has become since.
 * Recomputing it here from today's rate would pay the batch cooker something else than
 * what they were shown. A payment that covers part of the booking takes its share.
 *
 * That difference is everything Lab's Food keeps, VAT included; the VAT inside it is
 * split out for the commission invoice.
 *
 * Any other booking is charged the rate in force: the admin setting, and the
 * environment default while none was ever saved.
 */
export async function commissionForPayment(
  db: CommissionPolicyDb,
  booking: { id: string },
  amountCents: number,
  defaults: CommissionRates,
): Promise<CommissionBreakdown> {
  const quote = await db.quote.findUnique({
    where: { bookingId: booking.id },
    select: { offers: ACCEPTED_OFFER },
  });
  const offer = quote?.offers[0] ?? null;
  const rates = hasDeal(offer)
    ? defaults
    : { ...defaults, rateBps: await rateInForce(db, defaults.rateBps) };
  return commissionFor(offer, amountCents, rates);
}

/** The accepted offer of a booking's request, as `commissionFor` reads it. */
export const ACCEPTED_OFFER = {
  where: { status: 'accepted' },
  take: 1,
  select: { netCents: true, clientPriceCents: true, commissionBps: true },
} as const;

export interface OfferDeal {
  netCents: number;
  clientPriceCents: number;
  commissionBps: number;
}

const hasDeal = (offer: OfferDeal | null): offer is OfferDeal =>
  Boolean(offer && offer.clientPriceCents > 0);

/** The admin's rate, or `fallbackBps` while none was ever saved. */
export async function rateInForce(
  db: Pick<Prisma.TransactionClient, 'platformSetting'>,
  fallbackBps: number,
): Promise<number> {
  const setting = await db.platformSetting.findUnique({ where: { key: COMMISSION_KEY } });
  return typeof setting?.value === 'number' ? setting.value : fallbackBps;
}

/**
 * The pure core of `commissionForPayment`: the offer's deal when there is one,
 * otherwise `rates`, whose `rateBps` must already be the rate in force.
 */
export function commissionFor(
  offer: OfferDeal | null,
  amountCents: number,
  rates: CommissionRates,
): CommissionBreakdown {
  if (!hasDeal(offer)) return computeCommission(amountCents, rates);

  const whole = Math.max(0, offer.clientPriceCents - offer.netCents);
  const amountTtcCents = Math.min(
    amountCents,
    Math.round((whole * amountCents) / offer.clientPriceCents),
  );
  const amountHtCents = Math.round((amountTtcCents * BPS) / (BPS + rates.vatRateBps));
  return {
    rateBps: offer.commissionBps,
    vatRateBps: rates.vatRateBps,
    amountHtCents,
    amountVatCents: amountTtcCents - amountHtCents,
    amountTtcCents,
  };
}
