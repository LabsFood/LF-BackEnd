import { AllergiesService } from './allergies.service';
import { HEALTH_CONSENT } from './domain/allergies.rules';

const EARLIER = new Date('2026-10-01T10:00:00.000Z');

describe('AllergiesService', () => {
  let prisma: {
    clientProfile: Record<string, jest.Mock>;
    booking: { findMany: jest.Mock };
  };
  let users: Record<string, jest.Mock>;
  let notifications: { notify: jest.Mock };
  let service: AllergiesService;
  let logs: unknown[];

  const booking = (allergens: string[]) => ({
    id: 'booking-1',
    quote: null,
    chefProfile: { userId: 'chef-user' },
    bookingMeals: [{ meal: { id: 'meal-1', allergens, allergensNone: false } }],
  });

  beforeEach(() => {
    prisma = {
      clientProfile: {
        findUnique: jest.fn().mockResolvedValue({
          allergies: ['milk'],
          customAllergies: [],
          allergiesNone: false,
          allergiesDeclaredAt: EARLIER,
        }),
        upsert: jest.fn(({ update }) => Promise.resolve({ id: 'cp-1', ...update })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
      assertNoConflictingProfile: jest.fn().mockResolvedValue(undefined),
      getProfileByClerkUserId: jest.fn().mockResolvedValue({ profileType: 'client' }),
    };
    notifications = { notify: jest.fn().mockResolvedValue({}) };
    service = new AllergiesService(
      prisma as never,
      users as never,
      notifications as never,
    );
    logs = [];
    const logger = (service as unknown as { logger: Record<string, unknown> }).logger;
    logger.log = (entry: unknown) => logs.push(entry);
    logger.error = (entry: unknown) => logs.push(entry);
  });

  const declare = (allergies: string[]) =>
    service.declare('clerk_1', {
      allergies,
      consent: true,
      consentVersion: HEALTH_CONSENT.version,
    });

  it('saves the answer with its consent, and returns the profile as GET /me/profile', async () => {
    await expect(declare(['peanuts'])).resolves.toEqual({ profileType: 'client' });

    expect(prisma.clientProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'client-1' },
        create: expect.objectContaining({
          userId: 'client-1',
          allergies: ['peanuts'],
          healthConsentVersion: HEALTH_CONSENT.version,
        }),
      }),
    );
  });

  it('tells the client and the batch cooker when a validated dish is newly in conflict', async () => {
    prisma.booking.findMany.mockResolvedValue([booking(['peanuts'])]);

    await declare(['milk', 'peanuts']);

    const subject = { type: 'booking', id: 'booking-1' };
    expect(notifications.notify).toHaveBeenCalledWith(
      'client-1',
      'allergy.conflict',
      subject,
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      'chef-user',
      'mission.allergy_conflict',
      subject,
    );
  });

  it('stays quiet about a conflict that was already there', async () => {
    prisma.booking.findMany.mockResolvedValue([booking(['milk'])]);

    await declare(['milk', 'eggs']);

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('keeps the declaration when the check after it fails', async () => {
    prisma.booking.findMany.mockRejectedValue(new Error('db down'));

    await expect(declare(['peanuts'])).resolves.toBeDefined();
    expect(logs).toContainEqual({
      event: 'client.allergies_recheck_failed',
      userId: 'client-1',
    });
  });

  it('never logs an allergy', async () => {
    prisma.booking.findMany.mockResolvedValue([booking(['peanuts'])]);

    await declare(['peanuts']);

    expect(JSON.stringify(logs)).not.toMatch(/peanuts|milk/);
  });

  it('withdrawing consent erases the allergies and asks the question again', async () => {
    await service.withdraw('clerk_1');

    expect(prisma.clientProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'client-1' },
      data: {
        allergies: [],
        customAllergies: [],
        allergiesNone: false,
        allergiesDeclaredAt: null,
        healthConsentAt: null,
        healthConsentVersion: null,
      },
    });
  });
});
