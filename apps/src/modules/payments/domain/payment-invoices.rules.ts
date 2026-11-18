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

/**
 * Numbers follow a template: `YY` is the year's last two digits, the trailing run of `X`
 * the year's sequence, zero-padded to its width. `LF-CUSYY-XXXXX` gives `LF-CUS26-00001`.
 */
const TEMPLATE = /^([^X]*)YY([^X]*?)(X+)$/;

function parseTemplate(template: string): { head: string; tail: string; width: number } {
  const match = TEMPLATE.exec(template);
  if (!match) {
    throw new UnprocessableEntityException({
      code: 'INVOICE_TEMPLATE_INVALID',
      message: `Invoice template must hold YY and end with a run of X, got ${template}.`,
    });
  }
  return { head: match[1], tail: match[2], width: match[3].length };
}

/** What every number of that year starts with: `LF-CUS26-`. */
export function invoiceNumberPrefix(template: string, year: number): string {
  const { head, tail } = parseTemplate(template);
  return `${head}${String(year % 100).padStart(2, '0')}${tail}`;
}

/** Past the width of the Xs the number simply gets longer. */
export function formatInvoiceNumber(
  template: string,
  year: number,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new UnprocessableEntityException({
      code: 'INVOICE_SEQUENCE_INVALID',
      message: `Invoice sequence must be a positive integer, got ${sequence}.`,
    });
  }
  const { width } = parseTemplate(template);
  return `${invoiceNumberPrefix(template, year)}${String(sequence).padStart(width, '0')}`;
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
    { label: 'Forfait courses', amountCents: booking.shoppingFeeCents },
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
