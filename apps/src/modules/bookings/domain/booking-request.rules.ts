import type { BookingStatus, PaymentMethod } from '../../../generated/prisma/client';

/**
 * A direct booking under the CGV V1 (decision of 2026-11-19), as pure rules.
 *
 * The client chooses how they will pay and saves a card whatever the method (7.2):
 * nothing is charged. The request then goes to the batch cooker, who accepts or refuses
 * within 48 h, cut short at the start (5.2). Acceptance concludes the contract. The
 * price is charged after the session, or at acceptance for a card booking made less
 * than 48 h before the start (7.3).
 *
 * A booking without `paymentMethod` is the older pay-to-confirm model, left as it was
 * until every screen sends the method.
 */

const HOUR_MS = 60 * 60 * 1000;

/** The batch cooker's delay to answer a request (CGV 5.2). */
export const ACCEPT_WINDOW_MS = 48 * HOUR_MS;
/** How long a request waits for its card before it is dropped. */
export const CARD_WAIT_MS = HOUR_MS;
/** Under this much between acceptance and start, a card is charged at acceptance (7.3). */
export const SHORT_NOTICE_MS = 48 * HOUR_MS;
/** How long a CESU client has after the session to declare, before the card pays (7.5). */
export const CESU_GRACE_MS = 48 * HOUR_MS;

export function acceptBy(requestedAt: Date, startsAt: Date): Date {
  return new Date(Math.min(requestedAt.getTime() + ACCEPT_WINDOW_MS, startsAt.getTime()));
}

export type RequestState =
  'awaiting_card' | 'awaiting_chef' | 'accepted' | 'refused' | 'expired';

export interface RequestFacts {
  paymentMethod: PaymentMethod | null;
  status: BookingStatus;
  cardSavedAt: Date | null;
  requestedAt: Date | null;
  acceptedAt: Date | null;
  refusedAt: Date | null;
}

/** Where a request stands; null for a booking of the pay-to-confirm model. */
export function requestState(booking: RequestFacts): RequestState | null {
  if (!booking.paymentMethod) return null;
  if (booking.acceptedAt) return 'accepted';
  if (booking.refusedAt) return 'refused';
  if (booking.status === 'cancelled') return booking.requestedAt ? 'expired' : 'refused';
  return booking.requestedAt ? 'awaiting_chef' : 'awaiting_card';
}

/** When the price falls due (7.3). */
export function chargeDueAt(
  method: PaymentMethod,
  acceptedAt: Date,
  startsAt: Date,
  endsAt: Date,
): Date {
  const shortNotice = startsAt.getTime() - acceptedAt.getTime() < SHORT_NOTICE_MS;
  return method === 'cb' && shortNotice ? acceptedAt : endsAt;
}

export type MethodProblem =
  | 'METHOD_NOT_OFFERED'
  | 'CARD_NOT_AVAILABLE'
  | 'URSSAF_LINK_REFUSED'
  | 'URSSAF_LINK_NONE'
  | 'URSSAF_DOSSIER_MISSING';

/**
 * Why a method cannot be chosen at booking time, or null. The card must be payable
 * with this batch cooker whatever the method: it is saved on every booking and is the
 * fallback. A link still under review at URSSAF is accepted (decision of 2026-11-19).
 */
export function methodProblem(
  method: PaymentMethod,
  offered: Record<PaymentMethod, boolean>,
  urssafLink: 'pending' | 'active' | 'refused' | null,
  dossierMissing: boolean,
): MethodProblem | null {
  if (!offered[method]) return 'METHOD_NOT_OFFERED';
  if (!offered.cb) return 'CARD_NOT_AVAILABLE';
  if (method !== 'avance_immediate') return null;
  if (urssafLink === 'active' || urssafLink === 'pending') return null;
  if (urssafLink === 'refused') return 'URSSAF_LINK_REFUSED';
  return dossierMissing ? 'URSSAF_DOSSIER_MISSING' : 'URSSAF_LINK_NONE';
}

export type SettlementStep = 'none' | 'card' | 'urssaf' | 'remind_cesu';

export interface SettlementFacts {
  method: PaymentMethod;
  acceptedAt: Date;
  startsAt: Date;
  endsAt: Date;
  remainingCents: number;
  /** A payment waits on someone: a CESU declaration, an URSSAF answer, a card intent. */
  waiting: boolean;
  urssafLinkActive: boolean;
}

/** What the end-of-session job does for one booking, now. */
export function settlementPlan(booking: SettlementFacts, now: Date): SettlementStep {
  if (booking.remainingCents <= 0 || booking.waiting) return 'none';
  const due = chargeDueAt(
    booking.method,
    booking.acceptedAt,
    booking.startsAt,
    booking.endsAt,
  );
  if (now.getTime() < due.getTime()) return 'none';
  switch (booking.method) {
    case 'cb':
      return 'card';
    case 'avance_immediate':
      return booking.urssafLinkActive ? 'urssaf' : 'card';
    case 'cesu':
      return now.getTime() >= booking.endsAt.getTime() + CESU_GRACE_MS
        ? 'card'
        : 'remind_cesu';
  }
}
