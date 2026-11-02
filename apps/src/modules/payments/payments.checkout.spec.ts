import { ConfigService } from '@nestjs/config';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { PaymentInvoicesService } from './payment-invoices.service';
import { PaymentsService } from './payments.service';

const SITE = 'https://batchcooking.labsfood.fr';

const DONE_BOOKING = {
  id: 'booking-1',
  reference: 'LF-SM-2026-0001',
  status: 'confirmed',
  // Took place yesterday: a prestation is paid afterwards.
  endsAt: new Date(Date.now() - 86_400_000),
  amountTtc: 20_000,
  priceCents: 20_000,
  currency: 'EUR',
  chefProfile: {
    id: 'chef-1',
    isActive: false,
    isVerified: true,
    stripeAccountId: 'acct_123',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
  },
};

const body = (over: Record<string, unknown> = {}) => ({
  orderId: 'booking-1',
  method: 'card' as const,
  amountCents: 20_000,
  successUrl: `${SITE}/espace-client/commandes/booking-1?paiement=succes`,
  cancelUrl: `${SITE}/espace-client/commandes/booking-1?paiement=annule`,
  ...over,
});

function setup(booking: object = DONE_BOOKING) {
  const tx = {
    payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }), update: jest.fn() },
    commission: { updateMany: jest.fn() },
    booking: { update: jest.fn() },
  };
  const prisma = {
    booking: { findFirst: jest.fn().mockResolvedValue(booking) },
    payment: {
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountTtc: 0 } }),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    // Net 170 € on a 200 € offer: Lab's Food keeps 30 €.
    quote: {
      findUnique: jest.fn().mockResolvedValue({
        offers: [{ netCents: 17_000, clientPriceCents: 20_000, commissionBps: 1500 }],
      }),
    },
    platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const sessions = {
    create: jest
      .fn()
      .mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
    retrieve: jest.fn(),
  };
  const stripe = {
    configured: true,
    getClient: jest.fn(() => ({ checkout: { sessions } })),
  };
  const get = jest.fn((key: string, fallback?: unknown) =>
    key === 'cors.origins'
      ? [SITE]
      : key === 'payments.commissionVatRateBps'
        ? 2000
        : key === 'payments.commissionRateBps'
          ? 1500
          : fallback,
  );
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    stripe as unknown as StripeService,
    { get, getOrThrow: get } as unknown as ConfigService,
    {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as UsersService,
    {
      issue: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', invoiceNumber: 'LF-CUS26-00001' }),
      archive: jest.fn(),
    } as unknown as PaymentInvoicesService,
  );
  return { service, prisma, tx, sessions };
}

describe('PaymentsService.createCheckoutSession', () => {
  it('opens a Stripe page for what is due, keeping the offer’s commission', async () => {
    const { service, sessions, prisma } = setup();

    const result = await service.createCheckoutSession('clerk_1', body());

    expect(result).toEqual({
      sessionId: 'cs_1',
      url: 'https://checkout.stripe.com/c/pay/cs_1',
    });
    const [params, options] = sessions.create.mock.calls[0];
    expect(params.line_items[0].price_data).toMatchObject({
      currency: 'eur',
      unit_amount: 20_000,
    });
    // The cook receives 200 − 30 = 170 €, the net of their offer.
    expect(params.payment_intent_data).toMatchObject({
      on_behalf_of: 'acct_123',
      transfer_data: { destination: 'acct_123' },
      application_fee_amount: 3_000,
      metadata: { bookingId: 'booking-1', paymentId: 'pay-1' },
    });
    expect(options).toEqual({ idempotencyKey: 'checkout:pay-1' });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { metadata: { checkoutSessionId: 'cs_1' } },
    });
  });

  it('does not trust the amount the screen sends', async () => {
    const { service, sessions } = setup();

    await expect(
      service.createCheckoutSession('clerk_1', body({ amountCents: 100 })),
    ).rejects.toMatchObject({
      response: { code: 'AMOUNT_MISMATCH', amountCents: 20_000 },
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('refuses a prestation that has not taken place', async () => {
    const { service, sessions } = setup({
      ...DONE_BOOKING,
      endsAt: new Date(Date.now() + 86_400_000),
    });

    await expect(service.createCheckoutSession('clerk_1', body())).rejects.toMatchObject({
      response: { code: 'BOOKING_NOT_DUE' },
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('refuses a prestation in dispute', async () => {
    const { service, sessions } = setup({ ...DONE_BOOKING, status: 'disputed' });

    await expect(service.createCheckoutSession('clerk_1', body())).rejects.toMatchObject({
      response: { code: 'BOOKING_DISPUTED' },
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('only returns the client to one of our own sites', async () => {
    const { service, prisma } = setup();

    await expect(
      service.createCheckoutSession(
        'clerk_1',
        body({ successUrl: 'https://evil.example/thanks' }),
      ),
    ).rejects.toMatchObject({ response: { code: 'RETURN_URL_NOT_ALLOWED' } });
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
  });

  it('gives a second click the page already open', async () => {
    const { service, prisma, sessions } = setup();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-0',
      amountTtc: 20_000,
      metadata: { checkoutSessionId: 'cs_0' },
    });
    sessions.retrieve.mockResolvedValue({
      id: 'cs_0',
      status: 'open',
      payment_status: 'unpaid',
      url: 'https://checkout.stripe.com/c/pay/cs_0',
    });

    const result = await service.createCheckoutSession('clerk_1', body());

    expect(result.sessionId).toBe('cs_0');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('attaches the intent of a Checkout page to its payment when Stripe names it', async () => {
    const { service, prisma, tx } = setup();
    const row = {
      id: 'pay-1',
      bookingId: 'booking-1',
      amountTtc: 20_000,
      status: 'pending',
    };
    const lookups = { findUnique: jest.fn().mockResolvedValue(null) };
    Object.assign(prisma.payment, lookups);
    prisma.payment.findFirst.mockResolvedValue(row);
    prisma.payment.update.mockResolvedValue({ ...row, stripePaymentIntentId: 'pi_9' });
    Object.assign(tx.booking, {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'booking-1', status: 'confirmed', amountTtc: 20_000 }),
    });
    Object.assign(tx.payment, {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountTtc: 20_000 } }),
    });

    await service.handlePaymentIntentSucceeded({
      id: 'pi_9',
      metadata: { paymentId: 'pay-1' },
      latest_charge: 'ch_9',
    } as never);

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { stripePaymentIntentId: 'pi_9' },
    });
    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-1' },
        data: expect.objectContaining({ status: 'succeeded', stripeChargeId: 'ch_9' }),
      }),
    );
  });
});
