/**
 * The rules of a client ↔ batch cooker thread, as pure functions of the bookings
 * between the two. No rule is stored: a booking that moves or is cancelled
 * changes the answer at the next read.
 */

import type { BookingStatus } from '../../../generated/prisma/client';
import { GOING_AHEAD } from '../../bookings/domain/booking-status';

/** Contact details are released this long before a confirmed prestation (J-2). */
export const CONTACT_RELEASE_HOURS = 48;

/** A thread stays open for writing this long after a completed prestation. */
export const WRITE_GRACE_DAYS = 14;

export const MAX_BODY_LENGTH = 4000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;

export const DEFAULT_MESSAGE_PAGE_SIZE = 30;
export const MAX_MESSAGE_PAGE_SIZE = 100;

/** Messages one person may send per window, across all their conversations. */
export const SEND_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The part of a booking the rules read. Cancelled bookings are never passed in. */
export interface PairBooking {
  id: string;
  reference: string | null;
  status: Exclude<BookingStatus, 'cancelled'>;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Phone numbers and emails are readable from 48 h before a prestation that is going
 * ahead (confirmed, or under way) until it ends. Outside that window they are
 * masked again, so the release of one prestation does not carry over to the next.
 */
export function isContactReleased(bookings: PairBooking[], now: Date): boolean {
  return bookings.some(
    (b) =>
      GOING_AHEAD.includes(b.status) &&
      b.startsAt.getTime() - CONTACT_RELEASE_HOURS * HOUR_MS <= now.getTime() &&
      now.getTime() <= b.endsAt.getTime(),
  );
}

/** When the next release happens, for the notice in the thread. Null if none is due. */
export function nextContactReleaseAt(bookings: PairBooking[], now: Date): Date | null {
  if (isContactReleased(bookings, now)) return null;
  const upcoming = bookings
    .filter((b) => GOING_AHEAD.includes(b.status) && b.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  return upcoming
    ? new Date(upcoming.startsAt.getTime() - CONTACT_RELEASE_HOURS * HOUR_MS)
    : null;
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
