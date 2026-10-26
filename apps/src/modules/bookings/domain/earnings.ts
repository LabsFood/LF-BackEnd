import { commissionFor, type OfferDeal } from '../../payments/commission-policy';
import type { CommissionRates } from '../../payments/commission.util';

export interface EarningsInput {
  amountTtc: number | null;
  priceCents: number;
  /** The booking's `pending` and `succeeded` payments. */
  payments: {
    status: string;
    amountTtc: number;
    commission: { amountTtcCents: number } | null;
  }[];
  /** The accepted offer, for a booking born from a custom request. */
  offer: OfferDeal | null;
}

/**
 * What the batch cooker earns on a booking, and what Lab's Food keeps.
 *
 * The paid part keeps the commission frozen when each payment was taken. The rest
 * is priced as the next payment would be: a custom request keeps its offer's deal,
 * any other booking the rate in force (`rates.rateBps`). `commissionEstimated`
 * stays true until the booking is fully paid.
 */
export function bookingEarnings(booking: EarningsInput, rates: CommissionRates) {
  const amount = booking.amountTtc ?? booking.priceCents;
  const paid = booking.payments.filter((payment) => payment.status === 'succeeded');
  const paidCents = paid.reduce((sum, payment) => sum + payment.amountTtc, 0);
  const remaining = Math.max(0, amount - paidCents);

  const frozen = paid.reduce(
    (sum, payment) => sum + (payment.commission?.amountTtcCents ?? 0),
    0,
  );
  const ahead = remaining
    ? commissionFor(booking.offer, remaining, rates).amountTtcCents
    : 0;
  const commissionCents = frozen + ahead;

  return {
    netCents: amount - commissionCents,
    /** What has actually come in, after the commission taken on it: `netCents` counts the unpaid rest too. */
    collectedNetCents: paidCents - frozen,
    commissionCents,
    commissionEstimated: remaining > 0,
  };
}
