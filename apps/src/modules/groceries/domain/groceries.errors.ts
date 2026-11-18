import {
  ConflictException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Recettes lot 6: the codes the grocery flow answers (plan v5, « contrat commun »).
 * Every refusal says what to do next: a date, an amount, or the step that is missing.
 */

/** The client shops, or the offer has no groceries, or no mandate was accepted. */
export const groceriesNotApplicable = (): ConflictException =>
  new ConflictException({
    code: 'GROCERIES_NOT_APPLICABLE',
    message: 'This prestation has no groceries bought by the batch cooker.',
  });

/** The prestation is over (done, cancelled or disputed): no card is saved for it any more. */
export const groceriesBookingClosed = (status: string): ConflictException =>
  new ConflictException({
    code: 'GROCERIES_BOOKING_CLOSED',
    message: `This prestation is ${status}: a card can no longer be saved for its groceries.`,
  });

/** Groceries are paid by card only (no e-CESU, no SEPA) until the product decides. */
export const groceriesMethodNotAllowed = (method: string): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'GROCERIES_METHOD_NOT_ALLOWED',
    message: `Groceries are paid by card only, not by ${method}.`,
  });

export const groceryCardMissing = (): ConflictException =>
  new ConflictException({
    code: 'GROCERY_CARD_MISSING',
    message: 'Save a card for the groceries first.',
  });

/** The step asked for needs the hold placed at the lock (T-48h). */
export const groceryHoldMissing = (opensAt: Date): ConflictException =>
  new ConflictException({
    code: 'GROCERY_HOLD_MISSING',
    message: 'The Budget Courses is not held on the client’s card yet.',
    opensAt,
  });

/** Groceries before the lock (T-48h) are refused: the screen says when they open. */
export const groceryRunTooEarly = (opensAt: Date): ConflictException =>
  new ConflictException({
    code: 'GROCERY_RUN_TOO_EARLY',
    message: 'Groceries open at the lock, 48 hours before the prestation.',
    opensAt,
  });

export const groceryNoticeSent = (): ConflictException =>
  new ConflictException({
    code: 'GROCERY_NOTICE_SENT',
    message: 'The message before the groceries has already been sent.',
  });

/** The cancel deadline is sooner than the minimum notice the console sets. */
export const groceryDeadlineTooSoon = (earliest: Date): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'GROCERY_DEADLINE_TOO_SOON',
    message: 'The cancel deadline leaves the client too little time.',
    earliest,
  });

export const groceryDeadlineInvalid = (message: string): UnprocessableEntityException =>
  new UnprocessableEntityException({ code: 'GROCERY_DEADLINE_INVALID', message });

/** Receipts, before the client has confirmed (or the silence has). */
export const groceryNotConfirmed = (): ConflictException =>
  new ConflictException({
    code: 'GROCERY_NOT_CONFIRMED',
    message: 'The client has not confirmed the groceries: do not shop yet.',
  });

/** The client may no longer cancel: the groceries are done, or the run is over. */
export const groceryCancelClosed = (): ConflictException =>
  new ConflictException({
    code: 'GROCERY_CANCEL_CLOSED',
    message: 'The groceries can no longer be cancelled.',
  });

/** A receipts total above the Budget is refused: the gap stays with the chef. */
export const groceriesAboveMandate = (budgetCents: number, totalCents: number) =>
  new UnprocessableEntityException({
    code: 'GROCERIES_ABOVE_MANDATE',
    message: 'The receipts come to more than the Budget Courses.',
    budgetCents,
    totalCents,
  });

/** A Budget above the ceiling (kept for an admin correction of the budget). */
export const groceryBudgetAboveMax = (maxCents: number) =>
  new UnprocessableEntityException({
    code: 'GROCERY_BUDGET_ABOVE_MAX',
    message: 'The Budget Courses is above the ceiling.',
    maxCents,
  });

export const groceryReceiptsLate = (purchasedAt: Date) =>
  new UnprocessableEntityException({
    code: 'GROCERY_RECEIPTS_LATE',
    message: 'Receipts are deposited within 24 hours of the purchase.',
    purchasedAt,
  });

export const groceryReceiptsSent = (): ConflictException =>
  new ConflictException({
    code: 'GROCERY_RECEIPTS_SENT',
    message: 'The receipts of these groceries are already deposited.',
  });

/** Contesting a line after 48 h. */
export const groceryContestClosed = (closedAt: Date | null): ConflictException =>
  new ConflictException({
    code: 'GROCERY_CONTEST_CLOSED',
    message: 'Lines are contested within 48 hours of the receipts.',
    closedAt,
  });

export const groceryLineContested = (): ConflictException =>
  new ConflictException({
    code: 'GROCERY_LINE_CONTESTED',
    message: 'This line is already contested.',
  });

export const groceryLineNotFound = (): HttpException =>
  new UnprocessableEntityException({
    code: 'GROCERY_LINE_NOT_FOUND',
    message: 'No such line on these receipts.',
  });
