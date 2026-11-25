import { BookingRequestsService } from './booking-requests.service';

const H = 60 * 60 * 1000;
const NOW = new Date('2026-12-01T10:00:00Z');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  reference: 'LF-1',
  status: 'pending',
  clientId: 'client-1',
  chefProfileId: 'chef-1',
  startsAt: new Date(NOW.getTime() + 10 * 24 * H),
  endsAt: new Date(NOW.getTime() + 10 * 24 * H + 3 * H),
  amountTtc: 8400,
  priceCents: 8400,
  currency: 'EUR',
  paymentMethod: 'cb',
  stripeCustomerId: 'cus_1',
  cardSetupSessionId: null,
  cardSavedAt: NOW,
  requestedAt: NOW,
  acceptBy: new Date(NOW.getTime() + 48 * H),
  acceptedAt: null,
  autoChargedAt: null,
  cesuReminderSentAt: null,
  client: { email: 'c@x.fr', fullName: 'Claire Martin' },
  chefProfile: {
    displayName: 'BatchCo',
    userId: 'chef-user',
    user: { email: 'k@x.fr', fullName: 'Karim' },
  },
  ...over,
});

describe('BookingRequestsService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let payments: { chargeSavedCard: jest.Mock };
  let bookingPayments: { settleWithUrssafFor: jest.Mock };
  let mailer: Record<string, jest.Mock>;
  let service: BookingRequestsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(row()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountTtc: 0 } }),
      },
      urssafLink: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    payments = { chargeSavedCard: jest.fn().mockResolvedValue({ ok: true }) };
    bookingPayments = { settleWithUrssafFor: jest.fn().mockResolvedValue({}) };
    mailer = {
      requestDeclined: jest.fn(),
      chargeFailed: jest.fn(),
      cesuReminder: jest.fn(),
      requestChef: jest.fn(),
    };
    service = new BookingRequestsService(
      prisma as never,
      { chefIdentity: jest.fn().mockResolvedValue({ chefProfileId: 'chef-1' }) } as never,
      {} as never,
      {} as never,
      { record: jest.fn() } as never,
      { notify: jest.fn().mockResolvedValue(undefined) } as never,
      mailer as never,
      { detailFor: jest.fn().mockResolvedValue({ id: 'b1' }) } as never,
      payments as never,
      bookingPayments as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('accepting concludes the contract and charges nothing before the session', async () => {
    await service.accept('clerk', 'b1');
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'pending', acceptedAt: null, refusedAt: null },
      data: { status: 'confirmed', acceptedAt: NOW, concludedAt: NOW },
    });
    expect(payments.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('charges a card booking made on short notice at acceptance (7.3)', async () => {
    const soon = {
      startsAt: new Date(NOW.getTime() + 10 * H),
      endsAt: new Date(NOW.getTime() + 13 * H),
    };
    prisma.booking.findFirst.mockResolvedValue(row(soon));
    prisma.booking.findUniqueOrThrow.mockResolvedValue(row({ ...soon, acceptedAt: NOW }));
    await service.accept('clerk', 'b1');
    expect(payments.chargeSavedCard).toHaveBeenCalledWith('b1');
  });

  it('refuses an answer after the 48 h', async () => {
    prisma.booking.findFirst.mockResolvedValue(
      row({ acceptBy: new Date(NOW.getTime() - 1) }),
    );
    await expect(service.accept('clerk', 'b1')).rejects.toMatchObject({
      response: { code: 'REQUEST_EXPIRED' },
    });
  });

  it('a refusal cancels and tells the client nothing was charged', async () => {
    await service.refuse('clerk', 'b1', ' Complet ');
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'cancelled', refusedAt: NOW, refusalReason: 'Complet' },
      }),
    );
    expect(mailer.requestDeclined).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Complet', expired: false }),
    );
  });

  it('after the session: sends the advance to URSSAF when the link is active', async () => {
    const ended = {
      startsAt: new Date(NOW.getTime() - 4 * H),
      endsAt: new Date(NOW.getTime() - H),
    };
    prisma.booking.findMany.mockResolvedValue([{ id: 'b1' }]);
    prisma.booking.findUniqueOrThrow.mockResolvedValue(
      row({
        ...ended,
        status: 'confirmed',
        paymentMethod: 'avance_immediate',
        acceptedAt: new Date(NOW.getTime() - 9 * 24 * H),
      }),
    );
    prisma.urssafLink.findUnique.mockResolvedValue({ status: 'active' });
    await service.settleDue(NOW);
    expect(bookingPayments.settleWithUrssafFor).toHaveBeenCalledWith('b1');
    expect(payments.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('after the session: a refused card warns the client, once', async () => {
    const ended = {
      startsAt: new Date(NOW.getTime() - 4 * H),
      endsAt: new Date(NOW.getTime() - H),
    };
    prisma.booking.findMany.mockResolvedValue([{ id: 'b1' }]);
    prisma.booking.findUniqueOrThrow.mockResolvedValue(
      row({
        ...ended,
        status: 'confirmed',
        acceptedAt: new Date(NOW.getTime() - 9 * 24 * H),
      }),
    );
    payments.chargeSavedCard.mockResolvedValue({ ok: false, code: 'card_declined' });
    await service.settleDue(NOW);
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', autoChargedAt: null },
      data: { autoChargedAt: NOW },
    });
    expect(mailer.chargeFailed).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b1', amountCents: 8400 }),
    );
  });

  it('after the session: reminds a CESU client instead of charging', async () => {
    const ended = {
      startsAt: new Date(NOW.getTime() - 4 * H),
      endsAt: new Date(NOW.getTime() - H),
    };
    prisma.booking.findMany.mockResolvedValue([{ id: 'b1' }]);
    prisma.booking.findUniqueOrThrow.mockResolvedValue(
      row({
        ...ended,
        status: 'confirmed',
        paymentMethod: 'cesu',
        acceptedAt: new Date(NOW.getTime() - 9 * 24 * H),
      }),
    );
    await service.settleDue(NOW);
    expect(mailer.cesuReminder).toHaveBeenCalled();
    expect(payments.chargeSavedCard).not.toHaveBeenCalled();
  });
});
