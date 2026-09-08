/** Basis points denominator — 10 000 bps = 100 %. */
const BPS_DENOMINATOR = 10_000;

/**
 * Eight weeks, in days. Under the SEPA **CORE** scheme — the only one Stripe supports —
 * the debtor may dispute a debit "no questions asked" for eight weeks and the bank
 * honours it automatically. A collected commission is therefore never final before this
 * window closes.
 *
 * **Hard-coded, and not configurable on purpose**: this is the scheme's rule, not the
 * platform's. Exposing it as an environment variable would invite someone to "fix" a
 * non-conformity by editing a value.
 *
 * Lives here rather than beside the debit engine so the seed script can import it without
 * booting the Nest injection graph.
 */
export const SEPA_CLAWBACK_WINDOW_DAYS = 56;

export interface CommissionRates {
  /** Commission on the pre-VAT base, in basis points (1500 = 15 %). */
  rateBps: number;
  /** VAT charged on the commission itself, in basis points (2000 = 20 %). */
  vatRateBps: number;
}

export interface CommissionBreakdown extends CommissionRates {
  amountHtCents: number;
  amountVatCents: number;
  amountTtcCents: number;
}

/**
 * Platform commission on a booking, in minor units.
 *
 * VAT is computed from the rounded HT amount rather than from the base, so
 * `amountHtCents + amountVatCents === amountTtcCents` always holds — the TTC figure
 * is what Stripe collects as `application_fee_amount`, and an invoice that does not
 * add up would be a bookkeeping problem.
 *
 * The result is clamped to `baseAmountCents`: Stripe rejects an application fee larger
 * than the charge, and a misconfigured rate must not make every payment fail.
 */
export function computeCommission(
  baseAmountCents: number,
  rates: CommissionRates,
): CommissionBreakdown {
  const base = Math.max(0, Math.trunc(baseAmountCents));
  const rateBps = Math.max(0, rates.rateBps);
  const vatRateBps = Math.max(0, rates.vatRateBps);

  const amountHtCents = Math.round((base * rateBps) / BPS_DENOMINATOR);
  const amountVatCents = Math.round((amountHtCents * vatRateBps) / BPS_DENOMINATOR);
  const amountTtcCents = amountHtCents + amountVatCents;

  if (amountTtcCents <= base) {
    return { rateBps, vatRateBps, amountHtCents, amountVatCents, amountTtcCents };
  }

  // Over-cap: keep HT + VAT consistent by deriving HT back from the capped total.
  const cappedHt = Math.round((base * BPS_DENOMINATOR) / (BPS_DENOMINATOR + vatRateBps));
  return {
    rateBps,
    vatRateBps,
    amountHtCents: cappedHt,
    amountVatCents: base - cappedHt,
    amountTtcCents: base,
  };
}
