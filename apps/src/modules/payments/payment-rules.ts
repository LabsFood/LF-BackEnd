import { ConflictException } from '@nestjs/common';

import type { BookingStatus } from '../../generated/prisma/client';

/**
 * When a prestation can be paid.
 *
 * A prestation born from an accepted offer is `confirmed` from day one and is paid
 * **after** it took place (FLOW-03): nothing is asked for a session that has not
 * happened. A `pending` booking is the other model, where paying is what confirms
 * it; it stays payable at once.
 */
export type PaymentPhase = 'not_due' | 'due' | 'cancelled';

export interface PayableBooking {
  status: BookingStatus;
  endsAt?: Date | null;
}

export function paymentPhase(
  booking: PayableBooking,
  now: Date = new Date(),
): PaymentPhase {
  switch (booking.status) {
    case 'cancelled':
      return 'cancelled';
    case 'pending':
    case 'completed':
      return 'due';
    default:
      return booking.endsAt && booking.endsAt.getTime() <= now.getTime()
        ? 'due'
        : 'not_due';
  }
}

export function assertPayable(booking: PayableBooking, now: Date = new Date()): void {
  const phase = paymentPhase(booking, now);
  if (phase === 'cancelled') {
    throw new ConflictException({
      code: 'BOOKING_CANCELLED',
      message: 'A cancelled booking cannot be paid.',
    });
  }
  if (phase === 'not_due') {
    throw new ConflictException({
      code: 'BOOKING_NOT_DUE',
      message: 'This prestation is paid after it has taken place.',
    });
  }
}

/**
 * An uncollected commission stops a batch cooker taking on **new work**. Paying is
 * new work only where it confirms the booking; a client settling a prestation that
 * already took place must never be turned away because of their cook's debts.
 */
export const commissionBlockApplies = (booking: PayableBooking): boolean =>
  booking.status === 'pending';
