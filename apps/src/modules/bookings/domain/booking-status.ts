import type { BookingStatus } from '../../../generated/prisma/client';

/**
 * The life of a prestation, as pure rules:
 *
 * `pending` → `confirmed` → `shopping` → `cooking` → `delivered` → `completed`,
 * or `cancelled` on the way.
 *
 * `pending → confirmed` is payment's (`settlePayment`, once the payments cover the
 * amount) or an accepted offer's, never a PATCH's, except an admin's. What needs
 * the database (nothing paid yet, not started, not too early) is checked by
 * `BookingsService`.
 */

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'shopping',
  'cooking',
  'delivered',
  'completed',
  'cancelled',
] as const satisfies readonly BookingStatus[];

/** A prestation that is going ahead: confirmed, or under way. */
export const GOING_AHEAD: readonly BookingStatus[] = [
  'confirmed',
  'shopping',
  'cooking',
  'delivered',
];

/** Statuses that hold the batch cooker's time: other bookings cannot take it. */
export const HOLDS_SLOT: readonly BookingStatus[] = ['pending', ...GOING_AHEAD];

export type BookingActor = 'client' | 'chef' | 'admin';

const MOVES: Partial<Record<`${BookingStatus}>${BookingStatus}`, BookingActor[]>> = {
  'pending>cancelled': ['client', 'chef'],
  'confirmed>cancelled': ['client', 'chef'],
  'confirmed>shopping': ['chef'],
  'confirmed>cooking': ['chef'],
  'shopping>cooking': ['chef'],
  'cooking>delivered': ['chef'],
  'delivered>completed': ['client', 'chef'],
};

/** Whether `actor` may move a booking from `from` to `to`. An admin may do anything. */
export function canTransition(
  actor: BookingActor,
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  if (from === to) return false;
  if (actor === 'admin') return true;
  return MOVES[`${from}>${to}`]?.includes(actor) ?? false;
}

/** Arrival on site is the move into `cooking`, allowed from this long before the start. */
export const ARRIVAL_WINDOW_MS = 2 * 60 * 60 * 1000;
