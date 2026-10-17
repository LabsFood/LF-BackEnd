import { ConflictException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { UsersService } from '../users/users.service';
import { CreateQuoteDto } from './dto/quote.dto';
import { QuotesMailer } from './quotes.mailer';
import { QuotesService } from './quotes.service';

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const form = (over: Partial<CreateQuoteDto> = {}): CreateQuoteDto => ({
  title: 'Sunday prep',
  desiredDate: inDays(10),
  timeSlot: 'evening',
  persons: 4,
  mealsCount: 5,
  cuisine: 'mediterranean',
  brief: 'Family batch cooking',
  addressLine: '12 rue des Lilas',
  addressCity: 'Nice',
  addressPostalCode: '06000',
  ...over,
});

function setup() {
  const prisma = {
    quote: {
      count: jest.fn().mockResolvedValue(12),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...data,
          id: 'q1',
          status: 'submitted',
          client: { id: 'u1', fullName: 'Sophie Marchand', email: 's@exemple.fr' },
          offers: [],
          booking: null,
        }),
      ),
      findUnique: jest.fn(),
    },
    chefProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'chef-1', userId: 'u-chef' }),
    },
  };
  const users = { findByClerkId: jest.fn().mockResolvedValue({ id: 'u1' }) };
  const mailer = {
    needsChef: jest.fn().mockResolvedValue({ sent: true }),
    requestForChef: jest.fn().mockResolvedValue({ sent: true }),
  };
  const availability = { assertOpenOn: jest.fn().mockResolvedValue(undefined) };
  const service = new QuotesService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    mailer as unknown as QuotesMailer,
    { record: jest.fn() } as unknown as AuditService,
    availability as unknown as AvailabilityService,
  );
  return { service, prisma, mailer, availability };
}

describe('QuotesService.createQuote', () => {
  it('numbers the request after the ones of the year and stores it', async () => {
    const { service, prisma } = setup();

    const created = await service.createQuote('clerk_1', form());

    expect(created.reference).toBe(`DEM-${new Date().getUTCFullYear()}-0013`);
    expect(created.address.line).toBe('12 rue des Lilas');
    expect(prisma.quote.create).toHaveBeenCalledTimes(1);
  });

  it('tells the team when the client chose no batch cooker', async () => {
    const { service, mailer } = setup();

    const created = await service.createQuote('clerk_1', form());

    expect(created.chef).toBeNull();
    expect(mailer.needsChef).toHaveBeenCalledWith(
      expect.objectContaining({ why: 'unassigned', quoteId: 'q1' }),
    );
  });

  it('refuses a date that is not at least tomorrow', async () => {
    const { service, prisma } = setup();

    await expect(
      service.createQuote('clerk_1', form({ desiredDate: inDays(-1) })),
    ).rejects.toMatchObject({ response: { code: 'DATE_TOO_SOON' } });
    expect(prisma.quote.create).not.toHaveBeenCalled();
  });

  it('refuses a date more than a year ahead', async () => {
    const { service } = setup();

    await expect(
      service.createQuote('clerk_1', form({ desiredDate: inDays(400) })),
    ).rejects.toMatchObject({ response: { code: 'DATE_TOO_FAR' } });
  });

  it('takes a second identical send for a double click', async () => {
    const { service, prisma } = setup();
    const sent = form();
    prisma.quote.findMany.mockResolvedValue([
      {
        title: sent.title,
        desiredDate: new Date(`${sent.desiredDate}T00:00:00.000Z`),
        createdAt: new Date(),
      },
    ]);

    await expect(service.createQuote('clerk_1', sent)).rejects.toMatchObject({
      response: { code: 'DUPLICATE_REQUEST' },
    });
    expect(prisma.quote.create).not.toHaveBeenCalled();
  });

  it('caps the requests one client keeps open', async () => {
    const { service, prisma } = setup();
    prisma.quote.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        title: `Autre ${i}`,
        desiredDate: new Date('2027-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    );

    await expect(service.createQuote('clerk_1', form())).rejects.toMatchObject({
      status: 429,
      response: { code: 'TOO_MANY_OPEN_REQUESTS' },
    });
    expect(prisma.quote.create).not.toHaveBeenCalled();
  });
});

describe('QuotesService and closed days', () => {
  const closed = new ConflictException({
    code: 'CHEF_CLOSED_ON_DATE',
    message: 'The batch cooker does not work that day.',
  });

  it('refuses a request for a day the batch cooker closed', async () => {
    const { service, prisma, availability } = setup();
    availability.assertOpenOn.mockRejectedValue(closed);

    await expect(
      service.createQuote('clerk_1', form({ chefProfileId: 'chef-1' })),
    ).rejects.toMatchObject({ response: { code: 'CHEF_CLOSED_ON_DATE' } });
    expect(availability.assertOpenOn).toHaveBeenCalledWith(
      'chef-1',
      new Date(`${inDays(10)}T00:00:00.000Z`),
    );
    expect(prisma.quote.create).not.toHaveBeenCalled();
  });

  it('checks nothing when the client chose no batch cooker', async () => {
    const { service, availability } = setup();

    await service.createQuote('clerk_1', form());

    expect(availability.assertOpenOn).not.toHaveBeenCalled();
  });

  it('refuses to give a request to a batch cooker closed that day', async () => {
    const { service, prisma, availability } = setup();
    prisma.quote.findUnique.mockResolvedValue({
      id: 'q1',
      status: 'submitted',
      assignedChefUserId: null,
      desiredDate: new Date('2030-03-12T00:00:00.000Z'),
    });
    availability.assertOpenOn.mockRejectedValue(closed);

    await expect(
      service.updateAdmin('clerk_admin', 'q1', { assignedChefUserId: 'u-chef' }),
    ).rejects.toMatchObject({ response: { code: 'CHEF_CLOSED_ON_DATE' } });
    expect(availability.assertOpenOn).toHaveBeenCalledWith(
      'chef-1',
      new Date('2030-03-12T00:00:00.000Z'),
    );
  });
});

describe('QuotesService: Lab’s Food closes a request', () => {
  const open = (status: string) => ({
    id: 'q1',
    status,
    assignedChefUserId: 'u-chef',
    desiredDate: null,
  });

  function closing(status: string) {
    const ctx = setup();
    const tx = {
      quoteOffer: { updateMany: jest.fn() },
      quote: { update: jest.fn() },
    };
    Object.assign(ctx.prisma, {
      $transaction: jest.fn((work: (t: typeof tx) => unknown) => work(tx)),
    });
    ctx.prisma.quote.findUnique.mockResolvedValue(open(status));
    jest.spyOn(ctx.service, 'view').mockResolvedValue({} as never);
    return { ...ctx, tx };
  }

  it('closes even with an offer waiting, and withdraws that offer', async () => {
    const { service, tx } = closing('quoted');

    await service.updateAdmin('clerk_admin', 'q1', { status: 'closed' });

    expect(tx.quoteOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { quoteId: 'q1', status: { in: ['sent', 'viewed'] } },
        data: expect.objectContaining({ status: 'withdrawn' }),
      }),
    );
    expect(tx.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'closed' },
    });
  });

  it('cannot be reopened', async () => {
    const { service } = closing('closed');

    await expect(
      service.updateAdmin('clerk_admin', 'q1', { status: 'submitted' }),
    ).rejects.toMatchObject({ response: { code: 'QUOTE_CLOSED' } });
  });

  it('refuses closing and assigning in one go', async () => {
    const { service } = closing('submitted');

    await expect(
      service.updateAdmin('clerk_admin', 'q1', {
        status: 'closed',
        assignedChefUserId: 'u-other',
      }),
    ).rejects.toMatchObject({ response: { code: 'CLOSE_OR_ASSIGN' } });
  });

  it('is not rewritten as cancelled when the client cancels afterwards', async () => {
    const { service, prisma } = closing('closed');
    const update = jest.fn();
    Object.assign(prisma.quote, {
      findFirst: jest.fn().mockResolvedValue(open('closed')),
      update,
    });

    await service.cancelMine('clerk_1', 'q1');

    expect(update).not.toHaveBeenCalled();
  });
});
