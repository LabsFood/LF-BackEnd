import { AllergiesService } from './allergies.service';
import { HEALTH_CONSENT } from './domain/allergies.rules';

describe('AllergiesService', () => {
  let prisma: { clientProfile: Record<string, jest.Mock> };
  let users: Record<string, jest.Mock>;
  let service: AllergiesService;
  let logs: unknown[];

  beforeEach(() => {
    prisma = {
      clientProfile: {
        upsert: jest.fn(({ update }) => Promise.resolve({ id: 'cp-1', ...update })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
      assertNoConflictingProfile: jest.fn().mockResolvedValue(undefined),
      getProfileByClerkUserId: jest.fn().mockResolvedValue({ profileType: 'client' }),
    };
    service = new AllergiesService(prisma as never, users as never);
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

  it('never logs an allergy', async () => {
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
