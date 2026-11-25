/**
 * The rules of a client ↔ batch cooker thread, as pure functions of the bookings
 * between the two. Phone numbers and emails are never shared between a client and
 * a batch cooker: there is no release rule. No rule is stored: a booking that moves or is cancelled
 * changes the answer at the next read.
 */

import type { BookingStatus } from '../../../generated/prisma/client';

/** A thread stays open for writing this long after a completed prestation. */
export const WRITE_GRACE_DAYS = 14;

export const MAX_BODY_LENGTH = 4000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;

export const DEFAULT_MESSAGE_PAGE_SIZE = 30;
export const MAX_MESSAGE_PAGE_SIZE = 100;

/** Messages one person may send per window, across all their conversations. */
export const SEND_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The part of a booking the rules read. Cancelled bookings are never passed in. */
export interface PairBooking {
  id: string;
  reference: string | null;
  status: Exclude<BookingStatus, 'cancelled'>;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Open while a prestation is ahead or under way, and for 14 days after one ends
 * (`delivered` or `completed`). After that the thread is read-only and questions
 * go to support.
 */
export function isWritable(bookings: PairBooking[], now: Date): boolean {
  return bookings.some(
    (b) =>
      (b.status !== 'delivered' && b.status !== 'completed') ||
      b.endsAt.getTime() + WRITE_GRACE_DAYS * DAY_MS >= now.getTime(),
  );
}

/** The prestation the thread is about right now: the next one, else the latest. */
export function currentBooking(bookings: PairBooking[], now: Date): PairBooking | null {
  const byStart = [...bookings].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const ahead = byStart.find(
    (b) => b.status !== 'completed' && b.endsAt.getTime() >= now.getTime(),
  );
  return ahead ?? byStart[byStart.length - 1] ?? null;
}

/** "Sophie M.": enough to recognise a client, not enough to look them up. */
export function shortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Client';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
