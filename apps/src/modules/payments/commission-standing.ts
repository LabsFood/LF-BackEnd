import { ConflictException } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';

/** Statuses that mean a debit is alive or already won — the invoice is not stuck. */
const LIVE_DEBIT_STATUSES = ['pending', 'processing', 'succeeded'] as const;

export type CommissionStandingDb = Pick<
  Prisma.TransactionClient,
  'commissionInvoice' | 'commission'
>;

export interface CommissionStandingBlock {
  reason: 'debit_attempts_exhausted' | 'commission_reversed';
  /** Facture B that is blocking, when the block comes from an exhausted invoice. */
  invoiceNumber?: string;
  message: string;
}

/**
 * Whether a chef still receives bookings and payments, or is blocked on an unpaid
 * commission.
 *
 * This is the counterweight to accepting Stripe's SEPA **CORE** scheme (B2B is not
 * available on Stripe, so the "mandat SEPA B2B" of the commercial documentation is not
 * buildable). CORE lets the debtor revoke a debit for eight weeks, no questions asked,
 * so the platform cannot rely on a debit being final. Instead of trying to make the
 * debit safe, the exposure is capped: a chef whose commission cannot be collected stops
 * generating new commission.
 *
 * Two blocking situations, both requiring a human decision to clear:
 * - a facture B still `issued` whose debits have run out of attempts;
 * - a commission clawed back after a dispute — the money left the platform again.
 *
 * Checked at booking time **and** at payment time, the same double check as the
 * `isActive` / `isVerified` vetting: standing can change between the two.
 */
/**
 * Throws the block as a 409 when there is one. The three call sites — booking creation,
 * card payment, CESU declaration — all want exactly this, so the throw lives here rather
 * than being re-written beside each of them.
 */
export async function assertNoCommissionBlock(
  db: CommissionStandingDb,
  chefProfileId: string,
  maxAttempts: number,
): Promise<void> {
  const block = await findCommissionBlock(db, chefProfileId, maxAttempts);
  if (block) {
    throw new ConflictException(block.message);
  }
}

export async function findCommissionBlock(
  db: CommissionStandingDb,
  chefProfileId: string,
  maxAttempts: number,
): Promise<CommissionStandingBlock | null> {
  const exhausted = await db.commissionInvoice.findFirst({
    where: {
      chefProfileId,
      status: 'issued',
      debits: { some: { status: 'failed', attemptNumber: { gte: maxAttempts } } },
      // A retry in flight, or one that already went through, means the invoice is not
      // stuck — only an invoice with no live debit left blocks.
      NOT: { debits: { some: { status: { in: [...LIVE_DEBIT_STATUSES] } } } },
    },
    select: { invoiceNumber: true },
    orderBy: { issuedAt: 'asc' },
  });
  if (exhausted) {
    return {
      reason: 'debit_attempts_exhausted',
      invoiceNumber: exhausted.invoiceNumber,
      message:
        `Commission invoice ${exhausted.invoiceNumber} could not be collected by direct ` +
        'debit. New bookings and payments are suspended for this chef until it is settled.',
    };
  }

  const reversed = await db.commission.findFirst({
    where: { chefProfileId, status: 'reversed' },
    select: { id: true },
  });
  if (reversed) {
    return {
      reason: 'commission_reversed',
      message:
        'A commission collected from this chef was reversed by a SEPA dispute. New ' +
        'bookings and payments are suspended until the situation is settled.',
    };
  }

  return null;
}
