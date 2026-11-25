import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

/**
 * The slice of Prisma these helpers need. Satisfied by `PrismaService` and by the
 * transaction client `$transaction` hands to its callback, so a caller can settle
 * inside a wider transaction without a second connection.
 */
export type PaymentsDb = Pick<Prisma.TransactionClient, 'payment' | 'booking'>;

export interface SettleablePayment {
  id: string;
  bookingId: string;
  amountTtc: number;
}

export interface SettlementOutcome {
  /** Sum of every `succeeded` payment on the booking, this one included. */
  coveredAmountCents: number;
  bookingAmountTtcCents: number;
  /** Amount the client still owes on the booking. Never negative. */
  remainingAmountCents: number;
  /** Whether this settlement is what moved the booking to `confirmed`. */
  bookingConfirmed: boolean;
}

/**
 * The **only** writer of `Payment.status = 'succeeded'`, `paidAt` and
 * `taxCreditEligibleAmount`, shared by the card and CESU flows.
 *
 * Keeping it in one place is what makes the two flows agree on the three facts the
 * fiscal attestation reads. It also owns the booking transition: a booking becomes
 * `confirmed` only when its payments cover the full amount, which is what allows a
 * booking to be split between CESU and card.
 *
 * Caller-supplied `paidAt` rather than `new Date()` inside: a settlement written across
 * several rows must carry one timestamp, and a webhook replay must be able to reuse the
 * original one.
 */
export async function settlePayment(
  db: PaymentsDb,
  payment: SettleablePayment,
  options: { paidAt: Date; stripeChargeId?: string | null },
): Promise<SettlementOutcome> {
  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: 'succeeded',
      paidAt: options.paidAt,
      ...(options.stripeChargeId ? { stripeChargeId: options.stripeChargeId } : {}),
      failureReason: null,
      // The whole TTC amount of a home batch-cooking session is eligible for the 50 %
      // "service à la personne" tax credit, whatever it was paid with.
      taxCreditEligibleAmount: payment.amountTtc,
    },
  });

  const booking = await db.booking.findUnique({
    where: { id: payment.bookingId },
    select: { id: true, status: true, amountTtc: true, priceCents: true },
  });
  if (!booking) {
    throw new Error(`Payment ${payment.id} points at a missing booking.`);
  }

  const bookingAmountTtcCents = booking.amountTtc ?? booking.priceCents;
  const coveredAmountCents = await coveredAmount(db, payment.bookingId);
  const fullyCovered = coveredAmountCents >= bookingAmountTtcCents;

  // `pending` is the only status a payment may confirm out of: a cancelled booking that
  // is paid late must not silently come back to life.
  const bookingConfirmed = fullyCovered && booking.status === 'pending';
  if (bookingConfirmed) {
    // The contract is concluded now: the 14-day withdrawal period starts here.
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'confirmed', concludedAt: new Date() },
    });
  }

  return {
    coveredAmountCents,
    bookingAmountTtcCents,
    remainingAmountCents: Math.max(0, bookingAmountTtcCents - coveredAmountCents),
    bookingConfirmed,
  };
}

/**
 * What a booking has actually been paid, counting **`succeeded` payments only**.
 *
 * Deliberately not "everything that is not `failed`": `findReusableIntent` abandons a
 * `pending` row whenever `paymentIntents.retrieve` throws, and that row stays `pending`
 * forever. Counting it would inflate the coverage and a booking split across two payment
 * methods would never reach `confirmed`.
 */
export async function coveredAmount(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  bookingId: string,
): Promise<number> {
  const covered = await db.payment.aggregate({
    // Recettes lot 6: what is left to pay counts the service only, never the groceries.
    where: { bookingId, status: 'succeeded', purpose: 'service' },
    _sum: { amountTtc: true },
  });
  return covered._sum.amountTtc ?? 0;
}

/**
 * Whether a CESU declaration is waiting on the chef. `coveredAmount` leaves it out
 * (nothing is settled yet), so `remaining` still includes it: a card or advance charge
 * started now would cover the same amount a second time.
 */
export async function assertNoPendingCesu(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  bookingId: string,
): Promise<void> {
  const pending = await db.payment.count({
    where: { bookingId, method: 'cesu', status: 'pending', purpose: 'service' },
  });
  if (pending > 0) {
    throw new ConflictException({
      code: 'CESU_PENDING',
      message:
        'A CESU declaration is waiting for the batch cooker to confirm it. Pay the ' +
        'balance once it is confirmed, or after it is rejected.',
    });
  }
}

export interface BookingCoverage {
  bookingId: string;
  amountTtcCents: number;
  coveredAmountCents: number;
  remainingAmountCents: number;
  currency: string;
  fullyCovered: boolean;
}

/** Coverage of a booking, for the "amount left to pay" reads and the mixed-payment caps. */
export async function bookingCoverage(
  db: PaymentsDb,
  booking: {
    id: string;
    amountTtc: number | null;
    priceCents: number;
    currency: string;
  },
): Promise<BookingCoverage> {
  const amountTtcCents = booking.amountTtc ?? booking.priceCents;
  const coveredAmountCents = await coveredAmount(db, booking.id);
  return {
    bookingId: booking.id,
    amountTtcCents,
    coveredAmountCents,
    remainingAmountCents: Math.max(0, amountTtcCents - coveredAmountCents),
    currency: booking.currency,
    fullyCovered: coveredAmountCents >= amountTtcCents,
  };
}
