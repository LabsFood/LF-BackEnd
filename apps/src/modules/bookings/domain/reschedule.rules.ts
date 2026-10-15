import type { BookingStatus } from '../../../generated/prisma/client';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Nothing moves inside the last 48 h before a prestation: the batch cooker plans
 * their shopping, and contacts are released then (J-2).
 */
export const RESCHEDULE_NOTICE_MS = 48 * HOUR_MS;
/** How long the other side has to confirm a new time. */
export const RESCHEDULE_ANSWER_MS = 48 * HOUR_MS;

export type RescheduleSide = 'client' | 'chef';
export type RescheduleDecision = 'accepted' | 'declined' | 'withdrawn';

/**
 * Whether a booking may move from `currentStart` to `newStart` now: confirmed,
 * and both starts more than 48 h away. Checked when proposing and when confirming.
 */
export function canReschedule(
  status: BookingStatus,
  currentStart: Date,
  newStart: Date,
  now: Date,
): boolean {
  const ahead = (at: Date) => at.getTime() - now.getTime() > RESCHEDULE_NOTICE_MS;
  return status === 'confirmed' && ahead(currentStart) && ahead(newStart);
}

/**
 * 48 h to confirm, cut short to 48 h before the current start: a proposal made
 * 60 h ahead has 12 h.
 */
export const rescheduleExpiry = (proposedAt: Date, currentStart: Date) =>
  new Date(
    Math.min(
      proposedAt.getTime() + RESCHEDULE_ANSWER_MS,
      currentStart.getTime() - RESCHEDULE_NOTICE_MS,
    ),
  );

/**
 * Who may decide: the other side confirms or declines, the proposer withdraws.
 * Null when allowed, else the refusal's code.
 */
export function decisionRefusal(
  proposedBy: RescheduleSide,
  side: RescheduleSide,
  decision: RescheduleDecision,
): 'RESCHEDULE_OWN_PROPOSAL' | 'RESCHEDULE_NOT_YOURS' | null {
  const own = proposedBy === side;
  if (decision === 'withdrawn') return own ? null : 'RESCHEDULE_NOT_YOURS';
  return own ? 'RESCHEDULE_OWN_PROPOSAL' : null;
}
