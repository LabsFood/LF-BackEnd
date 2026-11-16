/**
 * The rules of a custom request, as pure functions: what an offer costs the
 * client, when a slot starts, and who may act in which status.
 */

import { parisMinute, parisToday } from '../../../common/paris-time';
import { TAX_CREDIT_BPS } from '../../platform-settings/pricing.constants';

const BPS = 10_000;

export const MIN_NET_CENTS = 1_000; // 10 €
export const MAX_NET_CENTS = 2_000_000; // 20 000 €
export const MIN_VALIDITY_DAYS = 1;
/** A prestation is asked for, or proposed, at most a year ahead. */
export const MAX_DAYS_AHEAD = 365;
/** Requests one client may have open at once: past that it is noise for the cooks. */
export const MAX_OPEN_REQUESTS = 10;
/** The same request sent again within this window is a double click, not a wish. */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
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
    afterTaxCreditCents: afterTaxCredit(clientPriceCents),
  };
}

/** What the client really bears after the "services à la personne" tax credit. */
export const afterTaxCredit = (clientPriceCents: number) =>
  Math.round((clientPriceCents * (BPS - TAX_CREDIT_BPS)) / BPS);

/** The half-days a prestation can be asked for, in Paris time. */
export const TIME_SLOTS = {
  morning: { from: '09:00', to: '13:00' },
  afternoon: { from: '14:00', to: '18:00' },
  evening: { from: '18:00', to: '22:00' },
} as const;

export type TimeSlot = keyof typeof TIME_SLOTS;
export const TIME_SLOT_KEYS = Object.keys(TIME_SLOTS) as TimeSlot[];

/** The instant at which a Paris wall clock shows `hh:mm` on that day. */
function parisTime(day: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return parisMinute(day, hours * 60 + minutes);
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

export { parisToday };

export const QUOTE_STATUSES = [
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'declined',
  'chef_declined',
  'cancelled',
  'closed',
] as const;
export type QuoteStatusKey = (typeof QUOTE_STATUSES)[number];

/** The batch cooker may answer: no offer is on the table and nothing is settled. */
export const AWAITING_CHEF: QuoteStatusKey[] = ['submitted', 'in_review', 'declined'];

/** Nothing more can happen to the request. */
export const CLOSED: QuoteStatusKey[] = ['accepted', 'cancelled', 'closed'];

/** An offer the client can still answer. */
export const ACTIVE_OFFER = ['sent', 'viewed'] as const;

export const QUOTE_STATUS_HELP =
  '`submitted`: waiting for the batch cooker’s answer, or for an admin to give it to ' +
  'one when `chef` is null. `quoted`: an offer is waiting for the client. `declined`: ' +
  'the client refused the last offer; the batch cooker may send another. ' +
  '`chef_declined`: the batch cooker turned the request down; an admin must reassign ' +
  'it. `accepted`: the offer was accepted and `booking` is the prestation. ' +
  '`cancelled`: withdrawn by the client. `closed`: closed by Lab’s Food without ' +
  'follow-up. `in_review`: an admin is working on it.';

// ── Dishes in an offer ───────────────────────────────────────────────────────

/** Dishes one offer may carry, menus' and express ones included. */
export const MAX_OFFER_DISHES = 30;
export const MAX_OFFER_MENUS = 5;
/** Express dishes written in one offer. */
export const MAX_EXPRESS_DISHES = 10;
export const EXPRESS_NAME_MAX = 160;
export const EXPRESS_DESCRIPTION_MAX = 1000;

export interface OfferDishLine {
  mealId: string;
  /** The menu it came with; null when added on its own. */
  menuId: string | null;
  position: number;
}

/**
 * The offer's dishes, in the order the client reads them: each menu's dishes
 * together, then the dishes added one by one, then the express ones. A dish met
 * twice (in a menu and on its own, or in two menus) is kept once, where first met.
 */
export function offerDishLines(input: {
  menus: { id: string; dishIds: string[] }[];
  dishIds: string[];
  expressIds: string[];
}): OfferDishLine[] {
  const lines: OfferDishLine[] = [];
  const seen = new Set<string>();
  const add = (mealId: string, menuId: string | null) => {
    if (seen.has(mealId)) return;
    seen.add(mealId);
    lines.push({ mealId, menuId, position: lines.length });
  };
  for (const menu of input.menus) for (const id of menu.dishIds) add(id, menu.id);
  for (const id of input.dishIds) add(id, null);
  for (const id of input.expressIds) add(id, null);
  return lines;
}

/** Where an express dish stands, as the keep-or-drop decision reads it. */
export interface ExpressUses {
  /** Statuses of the offers it is in. */
  offers: string[];
  /** Statuses of the prestations it is in. */
  bookings: string[];
}

/** Before the prestation is done, a dish may still be cooked as written. */
const BOOKING_NOT_DONE = ['pending', 'confirmed', 'shopping', 'cooking'];

/**
 * The batch cooker keeps or drops an express dish once nothing is waiting on it:
 * no offer the client can still accept, no prestation still to be cooked.
 */
export function expressDecisionBlock(
  uses: ExpressUses,
): 'OFFER_PENDING' | 'PRESTATION_PENDING' | null {
  if (uses.offers.some((s) => (ACTIVE_OFFER as readonly string[]).includes(s))) {
    return 'OFFER_PENDING';
  }
  if (uses.bookings.some((s) => BOOKING_NOT_DONE.includes(s)))
    return 'PRESTATION_PENDING';
  return null;
}
