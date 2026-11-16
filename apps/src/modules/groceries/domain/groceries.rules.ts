import { HttpException } from '@nestjs/common';

import {
  groceriesAboveMandate,
  groceryCancelClosed,
  groceryContestClosed,
  groceryDeadlineInvalid,
  groceryDeadlineTooSoon,
  groceryHoldMissing,
  groceryLineContested,
  groceryNotConfirmed,
  groceryNoticeSent,
  groceryReceiptsLate,
  groceryReceiptsSent,
  groceryRunTooEarly,
} from './groceries.errors';

/**
 * Recettes lot 6, pure rules (no database, no Stripe): when each step opens, what a
 * deposit, a contest or a capture may hold. Decisions of 31/10, 11/11 and 16/11.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * The particular mandate (Annexe 3), as accepted. Its clauses are copied on the run
 * when the mandate is accepted (`mandateRules`) and read from there afterwards: the
 * model will change again, and a prestation keeps the clauses its client accepted.
 */
export interface MandateRules {
  /** The Budget Courses: the mandate's maximum, the amount of the hold. */
  budgetCents: number;
  /** The lock (« Verrouillage »): the hold is placed, the groceries open. */
  lockHours: number;
  /** Receipts are deposited within this many hours of the purchase. */
  receiptsWithinHours: number;
  /** The card is charged this many hours after the deposit (CGV 10.8). */
  captureAfterHours: number;
  /** A line is contested within this many hours of the deposit. */
  contestHours: number;
}

export const MANDATE_VERSION = '2.0';

export const mandateRules = (budgetCents: number): MandateRules => ({
  budgetCents,
  lockHours: 48,
  receiptsWithinHours: 24,
  captureAfterHours: 24,
  contestHours: 48,
});

/** A stored `mandateRules`, each clause falling back on the 2.0 model. */
export function readMandateRules(raw: unknown, budgetCents: number): MandateRules {
  const base = mandateRules(budgetCents);
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, unknown>;
  const num = (key: keyof MandateRules) =>
    typeof value[key] === 'number' && (value[key] as number) > 0
      ? (value[key] as number)
      : base[key];
  return {
    budgetCents: num('budgetCents'),
    lockHours: num('lockHours'),
    receiptsWithinHours: num('receiptsWithinHours'),
    captureAfterHours: num('captureAfterHours'),
    contestHours: num('contestHours'),
  };
}

/** A card hold lives 7 days; Visa's online one, 4 days and 18 hours: the shortest. */
export const HOLD_LIFETIME_MS = (4 * 24 + 18) * HOUR_MS;
/** The safety capture: 6 hours before the hold would expire. */
export const SAFETY_CAPTURE_MS = 6 * HOUR_MS;

export const lockAt = (startsAt: Date, rules: Pick<MandateRules, 'lockHours'>): Date =>
  new Date(startsAt.getTime() - rules.lockHours * HOUR_MS);

/** When the hold expires: Stripe's `capture_before` when it says, else the shortest. */
export const holdExpiry = (placedAt: Date, captureBefore?: number | null): Date =>
  captureBefore
    ? new Date(Math.min(captureBefore * 1000, placedAt.getTime() + 7 * 24 * HOUR_MS))
    : new Date(placedAt.getTime() + HOLD_LIFETIME_MS);

/** Does this booking have groceries bought by the batch cooker, under a mandate? */
export const groceriesApply = (booking: {
  shoppingByClient: boolean;
  deboursMandateAcceptedAt: Date | null;
  serviceOffer: { shoppingIncluded: boolean };
}): boolean =>
  !booking.shoppingByClient &&
  booking.serviceOffer.shoppingIncluded &&
  booking.deboursMandateAcceptedAt !== null;

export type RunStatus =
  | 'awaiting_card'
  | 'card_saved'
  | 'hold_placed'
  | 'hold_failed'
  | 'notice_sent'
  | 'awaiting_client'
  | 'confirmed'
  | 'cancelled'
  | 'receipts_submitted'
  | 'captured'
  | 'settled';

/** The chef's message before the groceries (art. 8), checked before it is sent. */
export function noticeRefusal(input: {
  status: RunStatus;
  now: Date;
  startsAt: Date;
  rules: MandateRules;
  shoppingAt: Date;
  cancelDeadline: Date;
  minNoticeMinutes: number;
}): HttpException | null {
  const opensAt = lockAt(input.startsAt, input.rules);
  if (['notice_sent', 'awaiting_client', 'confirmed'].includes(input.status)) {
    return groceryNoticeSent();
  }
  if (input.status !== 'hold_placed') return groceryHoldMissing(opensAt);
  if (input.shoppingAt < opensAt) return groceryRunTooEarly(opensAt);
  if (input.shoppingAt > input.startsAt) {
    return groceryDeadlineInvalid('The groceries are done before the prestation starts.');
  }
  const earliest = new Date(input.now.getTime() + input.minNoticeMinutes * MINUTE_MS);
  if (input.cancelDeadline < earliest) return groceryDeadlineTooSoon(earliest);
  if (input.cancelDeadline > input.shoppingAt) {
    return groceryDeadlineInvalid('The cancel deadline comes before the groceries.');
  }
  return null;
}

/**
 * What the cancel deadline turns a sent message into. Confirmed by a click already, it
 * stays so. Otherwise the silence confirms only when the console allows it (off until
 * legal says so) and Brevo confirmed the e-mail was delivered before the deadline;
 * else the client must click, and the chef sees « en attente du client ».
 */
export function deadlineOutcome(input: {
  status: RunStatus;
  cancelDeadline: Date | null;
  emailDeliveredAt: Date | null;
  emailBouncedAt: Date | null;
  silenceConfirms: boolean;
  now: Date;
}): 'confirmed' | 'awaiting_client' | null {
  if (input.status !== 'notice_sent' || !input.cancelDeadline) return null;
  if (input.now < input.cancelDeadline) return null;
  const delivered =
    input.emailDeliveredAt !== null &&
    input.emailDeliveredAt <= input.cancelDeadline &&
    input.emailBouncedAt === null;
  return input.silenceConfirms && delivered ? 'confirmed' : 'awaiting_client';
}

/** The client cancels the groceries: until they are done, whatever the hour. */
export function cancelRefusal(status: RunStatus): HttpException | null {
  return [
    'awaiting_card',
    'card_saved',
    'hold_placed',
    'hold_failed',
    'notice_sent',
    'awaiting_client',
    'confirmed',
  ].includes(status)
    ? null
    : groceryCancelClosed();
}

/** After the lock, a cancellation keeps the prestation: the client buys the list. */
export const cancelIsLate = (now: Date, startsAt: Date, rules: MandateRules): boolean =>
  now >= lockAt(startsAt, rules);

export interface ReceiptInput {
  purchasedAt: Date;
}

export interface LineInput {
  label: string;
  amountCents: number;
  /** Index in the receipts deposited with it; null: a line without a receipt. */
  receipt: number | null;
}

/** One deposit of receipts, checked against the mandate. */
export function receiptsRefusal(input: {
  status: RunStatus;
  now: Date;
  startsAt: Date;
  rules: MandateRules;
  receipts: ReceiptInput[];
  lines: LineInput[];
}): HttpException | null {
  if (['receipts_submitted', 'captured', 'settled'].includes(input.status)) {
    return groceryReceiptsSent();
  }
  if (input.status !== 'confirmed') return groceryNotConfirmed();
  const opensAt = lockAt(input.startsAt, input.rules);
  for (const receipt of input.receipts) {
    if (receipt.purchasedAt < opensAt) return groceryRunTooEarly(opensAt);
    if (receipt.purchasedAt > input.now) {
      return groceryDeadlineInvalid('A receipt cannot be dated in the future.');
    }
    if (
      input.now.getTime() - receipt.purchasedAt.getTime() >
      input.rules.receiptsWithinHours * HOUR_MS
    ) {
      return groceryReceiptsLate(receipt.purchasedAt);
    }
  }
  for (const line of input.lines) {
    if (
      line.receipt !== null &&
      (line.receipt < 0 || line.receipt >= input.receipts.length)
    ) {
      return groceryDeadlineInvalid(
        `« ${line.label} » points at a receipt that is not there.`,
      );
    }
  }
  const total = input.lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (total > input.rules.budgetCents)
    return groceriesAboveMandate(input.rules.budgetCents, total);
  return null;
}

export interface StoredLine {
  id: string;
  amountCents: number;
  receiptId: string | null;
  clientApprovedAt: Date | null;
  contestedAt: Date | null;
  decision: 'upheld' | 'rejected' | null;
  refundedCents: number;
}

/**
 * What the card pays: every line with a receipt, or that the client approved without
 * one, except a contest already upheld. A contested line still open is charged, and
 * refunded if the contest is upheld (decision of 16/11).
 */
export const reimbursable = (line: StoredLine): boolean =>
  (line.receiptId !== null || line.clientApprovedAt !== null) &&
  line.decision !== 'upheld';

export const captureAmount = (lines: StoredLine[], budgetCents: number): number =>
  Math.min(
    budgetCents,
    lines.filter(reimbursable).reduce((sum, line) => sum + line.amountCents, 0),
  );

export function contestRefusal(
  line: Pick<StoredLine, 'contestedAt'>,
  contestClosesAt: Date | null,
  now: Date,
): HttpException | null {
  if (!contestClosesAt || now >= contestClosesAt)
    return groceryContestClosed(contestClosesAt);
  if (line.contestedAt) return groceryLineContested();
  return null;
}

/** Deposit → capture date and contest window, from the mandate's clauses. */
export const depositDeadlines = (submittedAt: Date, rules: MandateRules) => ({
  captureDueAt: new Date(submittedAt.getTime() + rules.captureAfterHours * HOUR_MS),
  contestClosesAt: new Date(submittedAt.getTime() + rules.contestHours * HOUR_MS),
});

/** Captured ahead of the 24 h when the hold would otherwise expire. */
export const safetyCaptureDue = (holdExpiresAt: Date | null, now: Date): boolean =>
  holdExpiresAt !== null && now.getTime() >= holdExpiresAt.getTime() - SAFETY_CAPTURE_MS;

/** The run is settled once the contest window is closed and every contest decided. */
export const settles = (
  contestClosesAt: Date | null,
  lines: Pick<StoredLine, 'contestedAt' | 'decision'>[],
  now: Date,
): boolean =>
  contestClosesAt !== null &&
  now >= contestClosesAt &&
  lines.every((line) => !line.contestedAt || line.decision !== null);

/** What an instant payout costs the chef: a rate, with a minimum, never above the amount. */
export const instantPayoutFee = (
  amountCents: number,
  rules: { instantPayoutFeeBps: number; instantPayoutFeeMinCents: number },
): number =>
  Math.min(
    amountCents,
    Math.max(
      rules.instantPayoutFeeMinCents,
      Math.round((amountCents * rules.instantPayoutFeeBps) / 10_000),
    ),
  );

/** An upheld contest refunds what is left of the line once captured. */
export const refundDue = (
  line: Pick<StoredLine, 'amountCents' | 'refundedCents'>,
): number => Math.max(0, line.amountCents - line.refundedCents);
