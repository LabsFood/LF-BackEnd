import { ConflictException } from '@nestjs/common';

import type { BookingStatus, PaymentMethod, Prisma } from '../../generated/prisma/client';
import { contractConsentRequired } from '../bookings/domain/contract.errors';
import { chargeDueAt } from '../bookings/domain/booking-request.rules';
import {
  chefShops,
  contractGaps,
  type ContractState,
} from '../bookings/domain/contract.rules';

/**
 * When a prestation can be paid.
 *
 * A prestation born from an accepted offer is `confirmed` from day one and is paid
 * **after** it took place (FLOW-03): nothing is asked for a session that has not
 * happened. A `pending` booking is the other model, where paying is what confirms
 * it; it stays payable at once.
 *
 * A CGV V1 direct booking (`paymentMethod` set, decision of 2026-11-19) is never paid
 * while it waits for the batch cooker; once accepted it falls due at `chargeDueAt`: the
 * end of the session, or acceptance for a card booking made on short notice (7.3).
 */
export type PaymentPhase = 'not_due' | 'due' | 'cancelled' | 'disputed';

export interface PayableBooking {
  status: BookingStatus;
  endsAt?: Date | null;
  paymentMethod?: PaymentMethod | null;
  acceptedAt?: Date | null;
  startsAt?: Date;
}

export function paymentPhase(
  booking: PayableBooking,
  now: Date = new Date(),
): PaymentPhase {
  switch (booking.status) {
    case 'cancelled':
      return 'cancelled';
    case 'disputed':
      return 'disputed';
    case 'pending':
      return booking.paymentMethod ? 'not_due' : 'due';
    case 'completed':
      return 'due';
    default: {
      const dueAt =
        booking.paymentMethod && booking.acceptedAt && booking.startsAt && booking.endsAt
          ? chargeDueAt(
              booking.paymentMethod,
              booking.acceptedAt,
              booking.startsAt,
              booking.endsAt,
            )
          : booking.endsAt;
      return dueAt && dueAt.getTime() <= now.getTime() ? 'due' : 'not_due';
    }
  }
}

/** What a payment needs to know of the contract (CGV art. 5.1). */
export interface ContractedBooking extends ContractState {
  startsAt: Date;
  createdAt: Date;
  shoppingByClient: boolean;
  serviceOffer: { shoppingIncluded: boolean };
}

/** Spread into a booking `select` (or added to an `include`) before `assertPayable`. */
export const CONTRACT_SELECT = {
  startsAt: true,
  createdAt: true,
  shoppingByClient: true,
  contractVersion: true,
  cgvAcceptedAt: true,
  deboursMandateAcceptedAt: true,
  earlyExecutionRequestedAt: true,
  serviceOffer: { select: { shoppingIncluded: true } },
} satisfies Prisma.BookingSelect;

/**
 * Whether money may be taken now. Also the one gate every payment route goes through
 * for the booking boxes: a booking made under the CGV V1 is never paid without them.
 * Paying concludes the contract now, so the 14 days are counted from `now`.
 */
export function assertPayable(
  booking: PayableBooking & ContractedBooking,
  now: Date = new Date(),
): void {
  const phase = paymentPhase(booking, now);
  if (phase === 'cancelled') {
    throw new ConflictException({
      code: 'BOOKING_CANCELLED',
      message: 'A cancelled booking cannot be paid.',
    });
  }
  // FLOW-03 §3: an open dispute blocks payment until an admin settles it.
  if (phase === 'disputed') {
    throw new ConflictException({
      code: 'BOOKING_DISPUTED',
      message: 'This prestation is in dispute: Lab’s Food will tell you what is due.',
    });
  }
  if (phase === 'not_due') {
    throw new ConflictException({
      code: 'BOOKING_NOT_DUE',
      message: 'This prestation is paid after it has taken place.',
    });
  }
  const missing = contractGaps(booking, {
    chefShops: chefShops(booking.serviceOffer, booking),
    startsAt: booking.startsAt,
    latestConclusion: now,
    bookedAt: booking.createdAt,
  });
  if (missing.length) throw contractConsentRequired(missing, 'payment');
}

/**
 * An uncollected commission stops a batch cooker taking on **new work**. Paying is
 * new work only where it confirms the booking; a client settling a prestation that
 * already took place must never be turned away because of their cook's debts.
 */
export const commissionBlockApplies = (booking: PayableBooking): boolean =>
  booking.status === 'pending' && !booking.paymentMethod;
