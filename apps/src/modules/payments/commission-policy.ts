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
    select: {
      offers: {
        where: { status: 'accepted' },
        take: 1,
        select: { netCents: true, clientPriceCents: true, commissionBps: true },
      },
    },
  });
  const offer = quote?.offers[0];

  if (offer && offer.clientPriceCents > 0) {
    const whole = Math.max(0, offer.clientPriceCents - offer.netCents);
    const amountTtcCents = Math.min(
      amountCents,
      Math.round((whole * amountCents) / offer.clientPriceCents),
    );
    const amountHtCents = Math.round(
      (amountTtcCents * BPS) / (BPS + defaults.vatRateBps),
    );
    return {
      rateBps: offer.commissionBps,
      vatRateBps: defaults.vatRateBps,
      amountHtCents,
      amountVatCents: amountTtcCents - amountHtCents,
      amountTtcCents,
    };
  }

  const setting = await db.platformSetting.findUnique({ where: { key: COMMISSION_KEY } });
  return computeCommission(amountCents, {
    rateBps: typeof setting?.value === 'number' ? setting.value : defaults.rateBps,
    vatRateBps: defaults.vatRateBps,
  });
}
