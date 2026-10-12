/**
 * The rules of a custom request, as pure functions: what an offer costs the
 * client, when a slot starts, and who may act in which status.
 */

import { TAX_CREDIT_BPS } from '../../platform-settings/pricing.constants';

const BPS = 10_000;

export const MIN_NET_CENTS = 1_000; // 10 €
export const MAX_NET_CENTS = 2_000_000; // 20 000 €
export const MIN_VALIDITY_DAYS = 1;
export const MAX_VALIDITY_DAYS = 30;

/**
 * From what the batch cooker wants to earn to what the client pays.
 *
 * The commission is taken out of the client price, so the net is what is left
 * of it: `client × (1 − rate) = net`. Rounded to the cent once, here, and then
 * stored: an offer is never recomputed.
 */
export function priceOffer(netCents: number, commissionBps: number) {
  const clientPriceCents = Math.round((netCents * BPS) / (BPS - commissionBps));
  return {
    clientPriceCents,
    commissionCents: clientPriceCents - netCents,
    afterTaxCreditCents: Math.round((clientPriceCents * (BPS - TAX_CREDIT_BPS)) / BPS),
  };
}

/** The half-days a prestation can be asked for, in Paris time. */
export const TIME_SLOTS = {
  morning: { from: '09:00', to: '13:00' },
  afternoon: { from: '14:00', to: '18:00' },
  evening: { from: '18:00', to: '22:00' },
} as const;

export type TimeSlot = keyof typeof TIME_SLOTS;
export const TIME_SLOT_KEYS = Object.keys(TIME_SLOTS) as TimeSlot[];

const PARIS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** How far ahead of UTC Paris is at that instant, in milliseconds. */
function parisOffsetMs(at: Date): number {
  const part = Object.fromEntries(PARIS.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(part.year),
    Number(part.month) - 1,
    Number(part.day),
    Number(part.hour),
    Number(part.minute),
    Number(part.second),
  );
  return asUtc - at.getTime();
}

/** The instant at which a Paris wall clock shows `hh:mm` on that day. */
function parisTime(day: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const wall = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    hours,
    minutes,
  );
  return new Date(wall - parisOffsetMs(new Date(wall)));
}

/**
 * When a slot starts and ends. `day` is a calendar date (a `DATE` column, read
 * as UTC midnight); the hours are Paris hours, summer or winter.
 */
export function slotWindow(day: Date, slot: TimeSlot) {
  const { from, to } = TIME_SLOTS[slot];
  return {
    startsAt: parisTime(day, from),
    endsAt: parisTime(day, to),
    /** As bookings store it: `09:00-13:00`. */
    label: `${from}-${to}`,
  };
}

/** Today's date in Paris, as the UTC-midnight `Date` a `DATE` column compares with. */
export function parisToday(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + parisOffsetMs(now));
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
}

export const QUOTE_STATUSES = [
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'declined',
  'chef_declined',
  'cancelled',
] as const;
export type QuoteStatusKey = (typeof QUOTE_STATUSES)[number];

/** The batch cooker may answer: no offer is on the table and nothing is settled. */
export const AWAITING_CHEF: QuoteStatusKey[] = ['submitted', 'in_review', 'declined'];

/** Nothing more can happen to the request. */
export const CLOSED: QuoteStatusKey[] = ['accepted', 'cancelled'];

/** An offer the client can still answer. */
export const ACTIVE_OFFER = ['sent', 'viewed'] as const;

export const QUOTE_STATUS_HELP =
  '`submitted`: waiting for the batch cooker’s answer, or for an admin to give it to ' +
  'one when `chef` is null. `quoted`: an offer is waiting for the client. `declined`: ' +
  'the client refused the last offer; the batch cooker may send another. ' +
  '`chef_declined`: the batch cooker turned the request down; an admin must reassign ' +
  'it. `accepted`: the offer was accepted and `booking` is the prestation. ' +
  '`cancelled`: withdrawn by the client. `in_review`: an admin is working on it.';
