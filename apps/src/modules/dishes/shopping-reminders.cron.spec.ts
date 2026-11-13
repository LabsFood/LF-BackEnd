import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShoppingRemindersCron } from './shopping-reminders.cron';

describe('ShoppingRemindersCron (Recettes lot 4, LF-0285)', () => {
  // Friday 20/11 at 09:00 in Paris: the list freezes Thursday 19/11 at noon.
  const startsAt = new Date('2026-11-20T08:00:00.000Z');
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    startsAt,
    clientId: 'client-1',
    groceriesValidatedAt: null,
    listReminderChefAt: null,
    listReminderClientAt: null,
    listFrozenNotifiedAt: null,
    groceriesReminderAt: null,
    chefProfile: { userId: 'chef-user' },
    shoppingList: null,
    ...over,
  });

  function harness(rows: unknown[]) {
    const prisma = {
      booking: {
        findMany: jest.fn(async () => rows),
        updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })),
      },
    };
    const notifications = { notify: jest.fn(async (..._args: unknown[]) => ({})) };
    const cron = new ShoppingRemindersCron(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
    return { prisma, notifications, cron };
  }

  it('claims the reminder, then tells the chef to send the list', async () => {
    const { prisma, notifications, cron } = harness([row()]);
    const now = new Date('2026-11-17T08:00:00.000Z');

    const sent = await cron.run(now);

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', listReminderChefAt: null },
      data: { listReminderChefAt: now },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      'chef-user',
      'shopping_list.reminder_send',
      { type: 'booking', id: 'b1' },
    );
    expect(sent).toMatchObject({ chef_send: 1, client_answer: 0 });
  });

  it('tells nobody when another instance claimed the reminder first', async () => {
    const { prisma, notifications, cron } = harness([row()]);
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });

    const sent = await cron.run(new Date('2026-11-17T08:00:00.000Z'));

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(sent.chef_send).toBe(0);
  });

  it('at the deadline tells the client the list is frozen and the chef to shop', async () => {
    const list = {
      version: 1,
      sentAt: new Date('2026-11-15T10:00:00.000Z'),
      finalReceivedAt: null,
    };
    const { notifications, cron } = harness([row({ shoppingList: list })]);

    await cron.run(new Date('2026-11-19T11:00:00.000Z'));

    expect(notifications.notify.mock.calls.map(([to, type]) => [to, type])).toEqual([
      ['client-1', 'shopping_list.frozen'],
      ['chef-user', 'groceries.reminder'],
    ]);
  });

  it('keeps going when a notification fails: the reminder stays claimed', async () => {
    const { notifications, cron } = harness([row(), row({ id: 'b2' })]);
    notifications.notify.mockRejectedValueOnce(new Error('down'));

    const sent = await cron.run(new Date('2026-11-17T08:00:00.000Z'));

    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(sent.chef_send).toBe(1);
  });
});
