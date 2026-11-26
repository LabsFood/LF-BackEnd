import { cesuFeeCents } from '../../platform-settings/cesu-fee';

/**
 * The « prix net » formula (MajorD, 25/11/2026): Lab’s Food sells the
 * prestation to the household **with VAT**, collects everything, and buys the batch
 * cooker's work at a net price, paid to them by transfer.
 *
 * Per payment the SAS received:
 * - HT = TTC ÷ (1 + VAT rate); the VAT goes to the State, to nobody else;
 * - Lab’s Food part = commission rate × HT (SAS margin, no VAT on it);
 * - CESU fee = fee rate × (CESU HT − commission on it), only on a CESU payment;
 * - net = HT − Lab’s Food part − CESU fee.
 *
 * Every rate is an input, frozen on the payout row: none is hard-coded here.
 */

const BPS = 10_000;

/**
 * VAT on home meal preparation sold as a "service à la personne": 10 %
 * (https://entreprendre.service-public.gouv.fr/vosdroits/F31596, confirmed by MajorD
 * 25/11/2026). The rate in force when a payout is created is frozen on it.
 */
export const SERVICE_VAT_RATE_BPS = 1000;

export interface NetPriceInput {
  amountTtcCents: number;
  vatRateBps: number;
  commissionRateBps: number;
  /** 0 for anything but CESU. */
  cesuFeeBps: number;
}

export interface NetPrice {
  amountTtcCents: number;
  vatRateBps: number;
  amountHtCents: number;
  amountVatCents: number;
  commissionRateBps: number;
  commissionCents: number;
  cesuFeeBps: number;
  cesuFeeCents: number;
  netCents: number;
}

/** The pre-VAT part of a VAT-inclusive amount, rounded to the cent. */
export const htOf = (amountTtcCents: number, vatRateBps: number): number =>
  Math.round((Math.max(0, amountTtcCents) * BPS) / (BPS + Math.max(0, vatRateBps)));

/** The Lab’s Food part on a pre-VAT amount, rounded to the cent. */
export const commissionOnHt = (amountHtCents: number, rateBps: number): number =>
  Math.round((amountHtCents * Math.max(0, rateBps)) / BPS);

export function netPrice(input: NetPriceInput): NetPrice {
  const amountTtcCents = Math.max(0, Math.trunc(input.amountTtcCents));
  const amountHtCents = htOf(amountTtcCents, input.vatRateBps);
  const commissionCents = commissionOnHt(amountHtCents, input.commissionRateBps);
  const fee = cesuFeeCents(amountHtCents, commissionCents, input.cesuFeeBps);
  return {
    amountTtcCents,
    vatRateBps: input.vatRateBps,
    amountHtCents,
    amountVatCents: amountTtcCents - amountHtCents,
    commissionRateBps: input.commissionRateBps,
    commissionCents,
    cesuFeeBps: input.cesuFeeBps,
    cesuFeeCents: fee,
    netCents: Math.max(0, amountHtCents - commissionCents - fee),
  };
}

/** Two working days after receipt, a payout not made yet is late. */
export const PAYOUT_LATE_AFTER_WORKING_DAYS = 2;

/** Whether `receivedAt` is more than `days` working days (Mon-Fri) before `now`. */
export function isLate(
  receivedAt: Date,
  now: Date,
  days = PAYOUT_LATE_AFTER_WORKING_DAYS,
): boolean {
  let counted = 0;
  const cursor = new Date(receivedAt);
  while (cursor < now) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && cursor <= now) counted += 1;
    if (counted > days) return true;
  }
  return false;
}

/**
 * The commission row of a payment the SAS collects (CESU, immediate advance): the Labs
 * Food part on the pre-VAT amount, without VAT (it is the SAS margin), kept back from
 * the payout rather than invoiced to the batch cooker.
 */
export function withheldCommission(amountTtcCents: number, rateBps: number) {
  const basisAmountCents = htOf(amountTtcCents, SERVICE_VAT_RATE_BPS);
  const amountHtCents = commissionOnHt(basisAmountCents, rateBps);
  return {
    rateBps,
    vatRateBps: 0,
    basisAmountCents,
    amountHtCents,
    amountVatCents: 0,
    amountTtcCents: amountHtCents,
    collectionMethod: 'payout_withholding' as const,
  };
}
