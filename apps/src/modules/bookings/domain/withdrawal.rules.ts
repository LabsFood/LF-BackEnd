import type { BookingStatus } from '../../../generated/prisma/client';
import { DAY_MS, parisMinute, parisToday } from '../../../common/paris-time';

/**
 * The right of withdrawal (CGV art. 15, Code de la consommation L.221-18 ff.).
 * Pure: `now` comes in, refusals go out as codes.
 */

/** The withdrawal period, in days, from the day the contract is concluded. */
export const WITHDRAWAL_DAYS = 14;

/** CGV art. 15.3: when only the shopping is done, its time is 20 % of the price. */
export const SHOPPING_SHARE = 0.2;

/** The declaration the client sends, as worded in the CGV's Annexe 1. */
export const WITHDRAWAL_DECLARATION =
  'Je vous notifie par la présente ma rétractation du contrat portant sur la ' +
  'prestation de services ci-dessous.';

/** Easter Sunday, at UTC midnight (anonymous Gregorian algorithm). */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const FIXED_HOLIDAYS = [
  '01-01',
  '05-01',
  '05-08',
  '07-14',
  '08-15',
  '11-01',
  '11-11',
  '12-25',
];
/** Easter Monday, Ascension, Whit Monday: days after Easter Sunday. */
const EASTER_HOLIDAYS = [1, 39, 50];

/**
 * A French public holiday, for a calendar date at UTC midnight.
 *
 * ponytail: national holidays only. Alsace-Moselle's Good Friday and 26 December
 * are not counted, so a deadline there can end a day early; add them with the
 * client's postcode if a client from there ever needs it.
 */
export function isFrenchPublicHoliday(day: Date): boolean {
  if (FIXED_HOLIDAYS.includes(day.toISOString().slice(5, 10))) return true;
  const sunday = easter(day.getUTCFullYear()).getTime();
  return EASTER_HOLIDAYS.some((after) => sunday + after * DAY_MS === day.getTime());
}

const isWorkingDay = (day: Date) =>
  day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !isFrenchPublicHoliday(day);

/**
 * The last instant a withdrawal can be sent: midnight in Paris at the end of the
 * fourteenth day after the day of conclusion, moved to the next working day when
 * that day is a Saturday, a Sunday or a public holiday (L.221-19, regulation
 * 1182/71). Returned as 23:59:59.999 Paris time, so it reads as the right day.
 */
export function withdrawalDeadline(concludedAt: Date): Date {
  let last = new Date(parisToday(concludedAt).getTime() + WITHDRAWAL_DAYS * DAY_MS);
  while (!isWorkingDay(last)) last = new Date(last.getTime() + DAY_MS);
  return new Date(parisMinute(new Date(last.getTime() + DAY_MS), 0).getTime() - 1);
}

export type WithdrawalRefusal =
  | 'WITHDRAWAL_NOT_CONCLUDED'
  | 'WITHDRAWAL_ALREADY_SENT'
  | 'BOOKING_CANCELLED'
  | 'WITHDRAWAL_PERIOD_OVER'
  | 'WITHDRAWAL_EXECUTED';

export interface WithdrawableBooking {
  status: BookingStatus;
  concludedAt: Date | null;
  withdrawnAt: Date | null;
  earlyExecutionRequestedAt: Date | null;
  amountTtc: number | null;
  priceCents: number;
}

export interface Withdrawal {
  /** Until when the button stays offered; null before the contract is concluded. */
  availableUntil: Date | null;
  refusal: WithdrawalRefusal | null;
  /** What the client still owes; null when an admin must set the share. */
  dueCents: number | null;
  /** What goes back to the client; null while the share is unknown. */
  refundCents: number | null;
}

/**
 * Whether the client may withdraw now, and what it costs.
 *
 * - Without an express request to start early, nothing is owed, whatever was done
 *   (L.221-25).
 * - With one: nothing before the prestation moves; 20 % of the price once only the
 *   shopping is done (CGV art. 15.3); an admin's call while cooking or in dispute.
 * - A prestation fully performed at the client's express request can no longer be
 *   withdrawn from (L.221-28 1°).
 *
 * The groceries bought for the client stay theirs and their exact cost stays due
 * (art. 15.3): there is no record of that cost yet (débours mandate, lot 4).
 */
export function withdrawalFor(
  booking: WithdrawableBooking,
  paidCents: number,
  now: Date,
): Withdrawal {
  const closed = (
    refusal: WithdrawalRefusal,
    availableUntil: Date | null,
  ): Withdrawal => ({
    availableUntil,
    refusal,
    dueCents: null,
    refundCents: null,
  });

  if (!booking.concludedAt) return closed('WITHDRAWAL_NOT_CONCLUDED', null);
  const availableUntil = withdrawalDeadline(booking.concludedAt);
  if (booking.withdrawnAt) return closed('WITHDRAWAL_ALREADY_SENT', availableUntil);
  if (booking.status === 'cancelled') return closed('BOOKING_CANCELLED', availableUntil);
  if (now.getTime() > availableUntil.getTime()) {
    return closed('WITHDRAWAL_PERIOD_OVER', availableUntil);
  }

  const early = booking.earlyExecutionRequestedAt !== null;
  const performed = booking.status === 'delivered' || booking.status === 'completed';
  if (early && performed) return closed('WITHDRAWAL_EXECUTED', availableUntil);

  const price = booking.amountTtc ?? booking.priceCents;
  let dueCents: number | null;
  if (!early || booking.status === 'confirmed') dueCents = 0;
  else if (booking.status === 'shopping') dueCents = Math.round(price * SHOPPING_SHARE);
  else dueCents = null;

  return {
    availableUntil,
    refusal: null,
    dueCents,
    refundCents: dueCents === null ? null : Math.max(0, paidCents - dueCents),
  };
}
