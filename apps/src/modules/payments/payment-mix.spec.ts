import { ConflictException } from '@nestjs/common';

import { assertMethodCombinable, methodsCombinable } from './payment-mix';

describe('methodsCombinable', () => {
  it.each([
    [[], 'cb'],
    [[], 'cesu'],
    [[], 'avance_immediate'],
    [['cesu'], 'cb'],
    [['cb'], 'cesu'],
    [['cb'], 'cb'],
  ] as const)('allows %j then %s', (existing, next) => {
    expect(methodsCombinable(existing, next)).toBe(true);
  });

  it.each([
    [['avance_immediate'], 'cb'],
    [['avance_immediate'], 'cesu'],
    [['cesu'], 'avance_immediate'],
    [['cb'], 'avance_immediate'],
  ] as const)('refuses %j then %s', (existing, next) => {
    expect(methodsCombinable(existing, next)).toBe(false);
  });
});

describe('assertMethodCombinable', () => {
  it('ignores failed payments, so a refused advance can be replaced by a card', async () => {
    const db = { payment: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(
      assertMethodCombinable(db as never, 'b1', 'cb'),
    ).resolves.toBeUndefined();
    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: 'b1', purpose: 'service', status: { not: 'failed' } },
      }),
    );
  });

  it('refuses CESU on a booking with a live immediate advance', async () => {
    const db = {
      payment: {
        findMany: jest.fn().mockResolvedValue([{ method: 'avance_immediate' }]),
      },
    };
    await expect(
      assertMethodCombinable(db as never, 'b1', 'cesu'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
