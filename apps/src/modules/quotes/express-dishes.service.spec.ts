import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpressDishesService } from './express-dishes.service';
import { QuotesService } from './quotes.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'express-1',
  name: 'Gâteau',
  description: null,
  allergens: ['eggs'],
  createdAt: new Date('2026-11-15T10:00:00Z'),
  expressDecision: null,
  expressQuote: { id: 'quote-1', reference: 'DEM-2026-0042', title: 'Anniversaire' },
  offerDishes: [{ offer: { status: 'accepted' } }],
  bookingMeals: [
    {
      booking: {
        id: 'booking-1',
        reference: 'LF-SM-2026-0042',
        status: 'delivered',
        startsAt: new Date('2026-11-28T09:00:00Z'),
      },
    },
  ],
  ...over,
});

describe('ExpressDishesService', () => {
  let prisma: {
    meal: { findMany: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let service: ExpressDishesService;

  beforeEach(() => {
    prisma = {
      meal: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findFirst: jest.fn().mockResolvedValue(row()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    audit = { record: jest.fn() };
    service = new ExpressDishesService(
      prisma as unknown as PrismaService,
      {
        chefIdentity: jest
          .fn()
          .mockResolvedValue({ userId: 'chef-user-1', chefProfileId: 'chef-1' }),
      } as unknown as QuotesService,
      audit as unknown as AuditService,
    );
  });

  it('lists the undecided ones with their request, prestation and what blocks', async () => {
    prisma.meal.findMany.mockResolvedValue([
      row(),
      row({
        id: 'express-2',
        offerDishes: [{ offer: { status: 'sent' } }],
        bookingMeals: [],
      }),
    ]);

    const list = await service.listMine('clerk_chef');

    expect(prisma.meal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          chefProfileId: 'chef-1',
          expressQuoteId: { not: null },
          expressDecision: null,
        },
      }),
    );
    expect(list[0]).toMatchObject({
      id: 'express-1',
      request: { reference: 'DEM-2026-0042' },
      prestation: { status: 'delivered' },
      decisionBlockedBy: null,
    });
    expect(list[1]).toMatchObject({
      prestation: null,
      decisionBlockedBy: 'OFFER_PENDING',
    });
  });

  it('keeps a dish as an ordinary draft, audited', async () => {
    await expect(service.decide('clerk_chef', 'express-1', 'kept')).resolves.toEqual({
      id: 'express-1',
      decision: 'kept',
    });
    expect(prisma.meal.updateMany).toHaveBeenCalledWith({
      where: { id: 'express-1', chefProfileId: 'chef-1', expressDecision: null },
      data: { expressDecision: 'kept', expressDecidedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dish.express_kept', subjectId: 'express-1' }),
    );
  });

  it('drops a dish by archiving it', async () => {
    await service.decide('clerk_chef', 'express-1', 'dropped');

    expect(prisma.meal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          expressDecision: 'dropped',
          expressDecidedAt: expect.any(Date),
          status: 'archived',
        },
      }),
    );
  });

  it('refuses while the prestation is still to be cooked', async () => {
    prisma.meal.findFirst.mockResolvedValue(
      row({
        bookingMeals: [
          {
            booking: {
              id: 'b',
              reference: null,
              status: 'confirmed',
              startsAt: new Date('2026-11-28T09:00:00Z'),
            },
          },
        ],
      }),
    );

    await expect(service.decide('clerk_chef', 'express-1', 'kept')).rejects.toMatchObject(
      {
        status: 409,
        response: { code: 'EXPRESS_DECISION_TOO_SOON', reason: 'PRESTATION_PENDING' },
      },
    );
    expect(prisma.meal.updateMany).not.toHaveBeenCalled();
  });

  it('changes nothing on the same decision again, refuses the other one', async () => {
    prisma.meal.findFirst.mockResolvedValue(row({ expressDecision: 'kept' }));

    await expect(service.decide('clerk_chef', 'express-1', 'kept')).resolves.toEqual({
      id: 'express-1',
      decision: 'kept',
    });
    await expect(
      service.decide('clerk_chef', 'express-1', 'dropped'),
    ).rejects.toMatchObject({
      response: { code: 'EXPRESS_ALREADY_DECIDED' },
    });
    expect(prisma.meal.updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a dish that is not an express dish of the caller', async () => {
    prisma.meal.findFirst.mockResolvedValue(null);

    await expect(service.decide('clerk_chef', 'other', 'kept')).rejects.toMatchObject({
      status: 404,
      response: { code: 'EXPRESS_DISH_NOT_FOUND' },
    });
  });
});
