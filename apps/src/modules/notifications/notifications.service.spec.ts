import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from './notifications.service';

const CREATED_AT = new Date('2026-10-31T09:00:00.000Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'n-1',
  userId: 'user-1',
  type: 'allergy_conflict',
  subjectType: 'booking',
  subjectId: 'b-1',
  readAt: null,
  createdAt: CREATED_AT,
  ...overrides,
});

function harness() {
  const prisma = {
    notification: {
      create: jest.fn(async () => row()),
      findMany: jest.fn(async () => [row()]),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async (): Promise<ReturnType<typeof row> | null> => row()),
      update: jest.fn(async () => row({ readAt: new Date() })),
    },
  };
  const users = {
    findByClerkId: jest.fn(async () => ({ id: 'user-1' })),
    ensurePersistedFromClerk: jest.fn(),
  };
  const service = new NotificationsService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
  );
  return { prisma, service };
}

describe('NotificationsService', () => {
  it('stores a type and what it is about, nothing else', async () => {
    const { prisma, service } = harness();

    await service.notify('user-1', 'allergy_conflict', { type: 'booking', id: 'b-1' });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'allergy_conflict',
        subjectType: 'booking',
        subjectId: 'b-1',
      },
    });
  });

  it('writes through the transaction it is given, so it lands with the change it reports', async () => {
    const { prisma, service } = harness();
    const tx = { notification: { create: jest.fn(async () => row()) } };

    await service.notify(
      'user-1',
      'recipe_allergens_changed',
      { type: 'meal', id: 'dish-1' },
      tx as unknown as PrismaService,
    );

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'recipe_allergens_changed',
        subjectType: 'meal',
        subjectId: 'dish-1',
      },
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("lists the caller's own notifications, newest first, with the unread count", async () => {
    const { prisma, service } = harness();

    const page = await service.listMine('clerk-1', { page: 1, limit: 20 });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
    );
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null },
    });
    expect(page.data).toEqual([
      {
        id: 'n-1',
        type: 'allergy_conflict',
        subjectType: 'booking',
        subjectId: 'b-1',
        readAt: null,
        createdAt: CREATED_AT,
      },
    ]);
    expect(page.unreadCount).toBe(1);
  });

  it('marks a notification read once, and leaves a read one as it is', async () => {
    const { prisma, service } = harness();

    const read = await service.markRead('clerk-1', 'n-1');

    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: 'n-1', userId: 'user-1' },
    });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { readAt: expect.any(Date) },
    });
    expect(read.readAt).toBeInstanceOf(Date);

    const earlier = new Date('2026-10-30T08:00:00.000Z');
    prisma.notification.findFirst.mockResolvedValueOnce(row({ readAt: earlier }));
    prisma.notification.update.mockClear();

    expect((await service.markRead('clerk-1', 'n-1')).readAt).toBe(earlier);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's notification, and changes nothing", async () => {
    const { prisma, service } = harness();
    prisma.notification.findFirst.mockResolvedValueOnce(null);

    await expect(service.markRead('clerk-1', 'n-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});
