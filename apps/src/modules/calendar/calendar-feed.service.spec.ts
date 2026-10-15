import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CalendarFeedService, feedInUse } from './calendar-feed.service';

interface FeedRow {
  chefProfileId: string;
  tokenHash: string;
  createdAt: Date;
  rotatedAt: Date | null;
  lastFetchedAt: Date | null;
}

const BOOKING = {
  id: 'b1',
  reference: 'LF-2030-0001',
  status: 'pending',
  startsAt: new Date('2030-03-12T08:00:00Z'),
  endsAt: new Date('2030-03-12T11:00:00Z'),
  persons: 4,
  addressLine: '12 rue des Lilas, 75011 Paris',
  addressCity: 'Paris',
  addressPostalCode: '75011',
  client: { fullName: 'Sophie Marchand' },
};

/** One batch cooker's feed row, kept in memory with the rules the queries carry. */
function feedTable() {
  let row: FeedRow | null = null;
  return {
    findUnique: jest.fn(
      async ({ where }: { where: { chefProfileId?: string; tokenHash?: string } }) =>
        row &&
        (where.chefProfileId === row.chefProfileId || where.tokenHash === row.tokenHash)
          ? row
          : null,
    ),
    upsert: jest.fn(
      async (args: {
        create: { chefProfileId: string; tokenHash: string };
        update: Partial<FeedRow>;
      }) => {
        row = row
          ? { ...row, ...args.update }
          : {
              ...args.create,
              createdAt: new Date(),
              rotatedAt: null,
              lastFetchedAt: null,
            };
        return row;
      },
    ),
    deleteMany: jest.fn(async () => {
      const count = row ? 1 : 0;
      row = null;
      return { count };
    }),
    updateMany: jest.fn(
      async (args: {
        where: { OR: [unknown, { lastFetchedAt: { lt: Date } }] };
        data: { lastFetchedAt: Date };
      }) => {
        const before = args.where.OR[1].lastFetchedAt.lt;
        if (!row || (row.lastFetchedAt && row.lastFetchedAt >= before)) {
          return { count: 0 };
        }
        row.lastFetchedAt = args.data.lastFetchedAt;
        return { count: 1 };
      },
    ),
    get row() {
      return row;
    },
  };
}

describe('CalendarFeedService', () => {
  let feeds: ReturnType<typeof feedTable>;
  let bookings: { findMany: jest.Mock; findFirst: jest.Mock };
  let service: CalendarFeedService;

  const tokenOf = (url: string) => url.match(/\/calendar\/feed\/(.+)\.ics$/)![1];

  beforeEach(() => {
    feeds = feedTable();
    bookings = {
      findMany: jest.fn().mockResolvedValue([BOOKING]),
      findFirst: jest.fn(),
    };
    const users = {
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'u1', chefProfileId: 'chef-1' }),
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
    };
    service = new CalendarFeedService(
      { chefCalendarFeed: feeds, booking: bookings } as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('shows the link once and keeps only its hash', async () => {
    const issued = await service.issue('clerk_1', 'https://api.labsfood.fr');

    expect(issued.url).toMatch(/^https:\/\/api\.labsfood\.fr\/calendar\/feed\/.+\.ics$/);
    expect(issued.webcalUrl.startsWith('webcal://api.labsfood.fr/')).toBe(true);
    expect(feeds.row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(feeds.row)).not.toContain(tokenOf(issued.url));
    expect(await service.status('clerk_1')).not.toHaveProperty('url');
  });

  it('serves the prestations, the client by first name and initial', async () => {
    const { url } = await service.issue('clerk_1', 'https://api');

    const ics = await service.feed(tokenOf(url), '203.0.113.9');

    expect(ics).toContain('UID:b1@labsfood.fr');
    expect(ics).toContain('SUMMARY:Prestation LF-2030-0001 · Sophie M.');
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toContain('en attente de paiement');
    expect(ics).not.toContain('Marchand');
    expect(bookings.findMany.mock.calls[0][0].where).toMatchObject({
      chefProfileId: 'chef-1',
      status: { not: 'cancelled' },
    });
  });

  it('stops the old link at once when a new one is made', async () => {
    const first = await service.issue('clerk_1', 'https://api');
    const second = await service.issue('clerk_1', 'https://api');

    await expect(service.feed(tokenOf(first.url), 'ip')).rejects.toMatchObject({
      response: { code: 'FEED_NOT_FOUND' },
    });
    await expect(service.feed(tokenOf(second.url), 'ip')).resolves.toContain('BEGIN');
  });

  it('answers a turned-off feed as an unknown one, and never logs the token', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { url } = await service.issue('clerk_1', 'https://api');
    await service.disable('clerk_1');

    await expect(service.feed(tokenOf(url), '203.0.113.9')).rejects.toMatchObject({
      response: { code: 'FEED_NOT_FOUND' },
    });
    expect(warn).toHaveBeenCalledWith({ event: 'feed.unknown_token', ip: '203.0.113.9' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(tokenOf(url));
  });

  it('stamps the fetch at most once an hour', async () => {
    const { url } = await service.issue('clerk_1', 'https://api');

    await service.feed(tokenOf(url), 'ip');
    const first = feeds.row!.lastFetchedAt;
    await service.feed(tokenOf(url), 'ip');

    expect(first).not.toBeNull();
    expect(feeds.row!.lastFetchedAt).toBe(first);
    expect((await service.status('clerk_1')).synced).toBe(true);
  });

  it('still serves the feed when the stamp fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { url } = await service.issue('clerk_1', 'https://api');
    feeds.updateMany.mockRejectedValueOnce(new Error('db down'));

    await expect(service.feed(tokenOf(url), 'ip')).resolves.toContain('BEGIN');
  });

  it('gives a client the file of their own booking only', async () => {
    bookings.findFirst.mockResolvedValue(null);

    await expect(service.bookingFile('clerk_1', 'b9')).rejects.toMatchObject({
      response: { code: 'BOOKING_NOT_FOUND' },
    });
    expect(bookings.findFirst.mock.calls[0][0].where).toEqual({
      id: 'b9',
      clientId: 'client-1',
    });
  });
});

describe('feedInUse', () => {
  const now = new Date('2030-03-12T12:00:00Z');

  it('is true for a fetch within 7 days, false after, or without one', () => {
    expect(feedInUse(new Date('2030-03-06T12:00:00Z'), now)).toBe(true);
    expect(feedInUse(new Date('2030-03-05T11:00:00Z'), now)).toBe(false);
    expect(feedInUse(null, now)).toBe(false);
  });
});
