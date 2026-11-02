import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Facture A: the invoice the client receives for a card payment, in the chef's name
 * (the chef is merchant of record through `on_behalf_of`). Pure rules only; the service
 * numbers, renders and stores.
 */

export interface InvoiceBookingFacts {
  offerName: string;
  /** What the booking costs the client in all, extras included. */
  amountTtcCents: number;
  shoppingFeeCents: number;
  extraPersonsCents: number;
  extraMealsCents: number;
}

export interface InvoiceLine {
  label: string;
  amountCents: number;
}

/** `<prefix>-<year>-NNNN`; past 9999 the number simply gets longer. */
export function formatInvoiceNumber(
  prefix: string,
  year: number,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new UnprocessableEntityException({
      code: 'INVOICE_SEQUENCE_INVALID',
      message: `Invoice sequence must be a positive integer, got ${sequence}.`,
    });
  }
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

/** The calendar year in Paris: an invoice paid at 00:30 on 1 January belongs to the new year. */
export function invoiceYear(paidAt: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
    }).format(paidAt),
  );
}

/**
 * The lines of the invoice for one payment. They always add up to `paidCents`.
 *
 * A payment that covers the whole booking shows the booking's breakdown. A part payment
 * (a booking split between CESU and card) is one line: which share of the extras it
 * paid is not something the booking records, so it is not invented here.
 */
export function invoiceLines(
  booking: InvoiceBookingFacts,
  paidCents: number,
): InvoiceLine[] {
  if (!Number.isInteger(paidCents) || paidCents < 1) {
    throw new UnprocessableEntityException({
      code: 'INVOICE_AMOUNT_INVALID',
      message: `Invoice amount must be a positive integer of cents, got ${paidCents}.`,
    });
  }

  const extras: InvoiceLine[] = [
    { label: 'Courses', amountCents: booking.shoppingFeeCents },
    { label: 'Adultes supplémentaires', amountCents: booking.extraPersonsCents },
    { label: 'Plats supplémentaires', amountCents: booking.extraMealsCents },
  ].filter((line) => line.amountCents > 0);
  const baseCents =
    booking.amountTtcCents - extras.reduce((total, line) => total + line.amountCents, 0);

  if (paidCents < booking.amountTtcCents) {
    return [
      { label: `Règlement partiel — ${booking.offerName}`, amountCents: paidCents },
    ];
  }
  // Extras above the total: the booking row is inconsistent, so show the one figure
  // that is certain rather than a negative base.
  if (baseCents < 1) {
    return [{ label: booking.offerName, amountCents: paidCents }];
  }
  return [{ label: booking.offerName, amountCents: baseCents }, ...extras];
}
