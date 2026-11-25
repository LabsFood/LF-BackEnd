import { ConflictException } from '@nestjs/common';

import type { PaymentMethod, Prisma } from '../../generated/prisma/client';

/**
 * Which methods may pay one booking together (MajorD, 25/11/2026): card alone, CESU
 * alone, the immediate advance alone, or CESU + card. **The immediate advance never
 * shares a booking with another method**: URSSAF pays the whole invoice and debits
 * the client's share itself, so any other payment would double-count the tax credit.
 */
export function methodsCombinable(
  existing: readonly PaymentMethod[],
  next: PaymentMethod,
): boolean {
  const all = new Set<PaymentMethod>([...existing, next]);
  return !(all.has('avance_immediate') && all.size > 1);
}

/** Refuses `next` when a live payment of the booking makes it an unallowed mix. */
export async function assertMethodCombinable(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  bookingId: string,
  next: PaymentMethod,
): Promise<void> {
  const live = await db.payment.findMany({
    where: { bookingId, purpose: 'service', status: { not: 'failed' } },
    select: { method: true },
  });
  if (
    !methodsCombinable(
      live.map((p) => p.method),
      next,
    )
  ) {
    throw new ConflictException({
      code: 'PAYMENT_MIX_NOT_ALLOWED',
      message:
        'The immediate advance cannot be combined with another payment method on one booking. ' +
        'Allowed: card, CESU, immediate advance, or CESU + card.',
    });
  }
}
