import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
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
    },
  };
  const users = { findByClerkId: jest.fn().mockResolvedValue({ id: 'u1' }) };
  const mailer = { needsChef: jest.fn().mockResolvedValue({ sent: true }) };
  const service = new QuotesService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    mailer as unknown as QuotesMailer,
    { record: jest.fn() } as unknown as AuditService,
  );
  return { service, prisma, mailer };
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
});
