import { randomBytes } from 'node:crypto';

import { open, seal } from '../../common/crypto/secret-box';
import { CronofyError, CronofyService } from '../../integrations/cronofy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CalendarConnectionService } from './calendar-connection.service';
import { signState } from './domain/oauth-state';

const KEY = randomBytes(32);

const TOKENS = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  sub: 'acc_1',
  linking_profile: {
    provider_name: 'google',
    profile_id: 'pro_1',
    profile_name: 'm@x.fr',
  },
};

const connection = (overrides: Record<string, unknown> = {}) => ({
  id: 'conn-1',
  chefProfileId: 'chef-1',
  status: 'active',
  calendarId: 'cal_1',
  accessTokenSealed: seal('access-1', KEY),
  refreshTokenSealed: seal('refresh-1', KEY),
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  ...overrides,
});

describe('CalendarConnectionService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
  let cronofy: Record<string, jest.Mock> & { configured: boolean; tokenKey: Buffer };
  let service: CalendarConnectionService;

  beforeEach(() => {
    prisma = {
      chefCalendarConnection: {
        findUnique: jest.fn().mockResolvedValue(connection()),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      chefProfile: { update: jest.fn() },
      booking: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as never;
    cronofy = {
      configured: true,
      tokenKey: KEY,
      authorizeUrl: jest.fn(
        (state: string) => `https://app-de.cronofy.com/oauth?state=${state}`,
      ),
      exchangeCode: jest.fn().mockResolvedValue(TOKENS),
      refresh: jest.fn().mockResolvedValue({ ...TOKENS, access_token: 'access-2' }),
      listCalendars: jest.fn().mockResolvedValue([
        {
          calendar_id: 'cal_ro',
          calendar_readonly: true,
          calendar_deleted: false,
          calendar_primary: true,
        },
        {
          calendar_id: 'cal_1',
          calendar_readonly: false,
          calendar_deleted: false,
          calendar_primary: false,
        },
      ]),
      freeBusy: jest.fn().mockResolvedValue([]),
      upsertEvent: jest.fn(),
      deleteEvent: jest.fn(),
      revoke: jest.fn(),
    } as never;
    const users = {
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'u1', chefProfileId: 'chef-1' }),
    };
    service = new CalendarConnectionService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      cronofy as unknown as CronofyService,
    );
  });

  describe('connect', () => {
    it('refuses a state made for someone else', async () => {
      await expect(
        service.connect('clerk_1', 'code', signState('chef-2', KEY)),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
      expect(cronofy.exchangeCode).not.toHaveBeenCalled();
    });

    it('stores the tokens sealed, on the first calendar that accepts events', async () => {
      await service.connect('clerk_1', 'code', signState('chef-1', KEY));

      const { create } = prisma.chefCalendarConnection.upsert.mock.calls[0][0];
      expect(create.calendarId).toBe('cal_1');
      expect(create.accessTokenSealed).not.toContain('access-1');
      expect(open(create.refreshTokenSealed, KEY)).toBe('refresh-1');
      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        data: { cronofyProfileId: 'pro_1' },
      });
    });

    it('answers 503 when Cronofy is not configured', async () => {
      cronofy.configured = false;

      await expect(service.connectUrl('clerk_1')).rejects.toMatchObject({
        response: { code: 'CALENDAR_UNAVAILABLE' },
      });
    });
  });

  describe('busy', () => {
    const from = new Date('2030-03-12T00:00:00Z');
    const to = new Date('2030-03-13T00:00:00Z');

    it('refreshes a token about to expire, and keeps the new one sealed', async () => {
      prisma.chefCalendarConnection.findUnique.mockResolvedValue(
        connection({ accessTokenExpiresAt: new Date(Date.now() + 30_000) }),
      );
      cronofy.freeBusy.mockResolvedValue([
        {
          start: '2030-03-12T09:00:00Z',
          end: '2030-03-12T10:00:00Z',
          free_busy_status: 'busy',
        },
        {
          start: '2030-03-12T11:00:00Z',
          end: '2030-03-12T12:00:00Z',
          free_busy_status: 'free',
        },
      ]);

      const busy = await service.busy('chef-1', from, to);

      expect(cronofy.refresh).toHaveBeenCalledWith('refresh-1');
      expect(cronofy.freeBusy).toHaveBeenCalledWith('access-2', from, to);
      expect(busy).toEqual([
        {
          start: Date.parse('2030-03-12T09:00:00Z'),
          end: Date.parse('2030-03-12T10:00:00Z'),
        },
      ]);
    });

    it('marks the link revoked when Cronofy no longer knows the grant', async () => {
      // The same row on the re-read: nobody rotated the tokens meanwhile.
      prisma.chefCalendarConnection.findUnique.mockResolvedValue(
        connection({ accessTokenExpiresAt: new Date(0) }),
      );
      cronofy.refresh.mockRejectedValue(
        new CronofyError(400, '{"error":"invalid_grant"}'),
      );

      expect(await service.busy('chef-1', from, to)).toEqual([]);
      expect(prisma.chefCalendarConnection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'revoked' }) }),
      );
    });

    it('keeps the link when another request rotated the tokens meanwhile', async () => {
      prisma.chefCalendarConnection.findUnique
        .mockResolvedValueOnce(connection({ accessTokenExpiresAt: new Date(0) }))
        .mockResolvedValueOnce(connection({ accessTokenSealed: seal('access-3', KEY) }));
      cronofy.refresh.mockRejectedValue(
        new CronofyError(400, '{"error":"invalid_grant"}'),
      );

      await service.busy('chef-1', from, to);

      expect(prisma.chefCalendarConnection.updateMany).not.toHaveBeenCalled();
      expect(cronofy.freeBusy).toHaveBeenCalledWith('access-3', from, to);
    });

    it('never blocks a booking on a Cronofy outage', async () => {
      cronofy.freeBusy.mockRejectedValue(new CronofyError(503, 'down'));

      expect(await service.busy('chef-1', from, to)).toEqual([]);
    });
  });

  describe('syncBooking', () => {
    const booking = (overrides: Record<string, unknown> = {}) => ({
      id: 'b1',
      reference: 'LF-2030-0001',
      status: 'pending',
      startsAt: new Date('2030-03-12T08:00:00Z'),
      endsAt: new Date('2030-03-12T11:00:00Z'),
      persons: 4,
      addressLine: '12 rue des Lilas',
      cronofyEventId: null,
      chefProfileId: 'chef-1',
      client: { fullName: 'Sophie Martin' },
      ...overrides,
    });

    it('writes a booking that holds the slot, keyed on its id', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking());

      await service.syncBooking('b1');

      expect(cronofy.upsertEvent).toHaveBeenCalledWith(
        'access-1',
        'cal_1',
        expect.objectContaining({
          event_id: 'b1',
          summary: 'Prestation LF-2030-0001 · Sophie M.',
          start: '2030-03-12T08:00:00.000Z',
          location: { description: '12 rue des Lilas' },
        }),
      );
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { cronofyEventId: 'b1' },
      });
    });

    it('removes a cancelled booking’s event', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        booking({ status: 'cancelled', cronofyEventId: 'b1' }),
      );

      await service.syncBooking('b1');

      expect(cronofy.deleteEvent).toHaveBeenCalledWith('access-1', 'cal_1', 'b1');
      expect(cronofy.upsertEvent).not.toHaveBeenCalled();
    });

    it('swallows a Cronofy failure: the booking stands', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking());
      cronofy.upsertEvent.mockRejectedValue(new CronofyError(500, 'boom'));

      await expect(service.syncBooking('b1')).resolves.toBeUndefined();
    });
  });
});
