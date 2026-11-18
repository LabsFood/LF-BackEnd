/**
 * Which commissions an admin may collect by hand from the chef's transactions
 * summary (immediate advance, manual route). The debit itself is the commission
 * engine's (`CommissionDebitsService`); this only says which lines may go in.
 */

export interface CollectableFacts {
  status: string;
  collectionMethod: string;
  commissionInvoiceId: string | null;
  /** The status of the payment the commission was taken on. */
  paymentStatus: string;
}

/**
 * Pending, collected by direct debit, not yet on a facture B, and on a prestation
 * already paid: the platform never debits a commission on money the chef has not had.
 */
export const commissionCollectable = (c: CollectableFacts): boolean =>
  c.status === 'pending' &&
  c.collectionMethod === 'sepa_direct_debit' &&
  c.commissionInvoiceId === null &&
  c.paymentStatus === 'succeeded';

export interface Total {
  count: number;
  amountTtcCents: number;
}

export function transactionTotals(
  commissions: readonly (CollectableFacts & { amountTtcCents: number })[],
) {
  const byStatus: Record<string, Total> = {};
  const collectable: Total = { count: 0, amountTtcCents: 0 };
  for (const c of commissions) {
    const total = (byStatus[c.status] ??= { count: 0, amountTtcCents: 0 });
    total.count += 1;
    total.amountTtcCents += c.amountTtcCents;
    if (commissionCollectable(c)) {
      collectable.count += 1;
      collectable.amountTtcCents += c.amountTtcCents;
    }
  }
  return { byStatus, collectable };
}
