import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { GroceriesService } from './groceries.service';
import { GroceriesStripe } from './groceries-stripe';

/**
 * Recettes lot 6 against a real Postgres, Stripe faked: the « Terminé quand » of the
 * plan, run through the service and the database constraints. Skipped unless
 * `GROCERIES_IT_DB` names a migrated database (it writes and deletes its own rows):
 *
 *   GROCERIES_IT_DB=postgresql://… SUPABASE_DB_URL=$GROCERIES_IT_DB npx jest groceries.integration
 */
const DB = process.env.GROCERIES_IT_DB;
const suite = DB ? describe : describe.skip;

const H = 60 * 60 * 1000;

suite('groceries on a real database (lot 6)', () => {
  let prisma: PrismaService;
  let service: GroceriesService;
  const stripe = {
    configured: true,
    createCustomer: jest.fn().mockResolvedValue('cus_test'),
    createSetupSession: jest
      .fn()
      .mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/c/cs_test' }),
    setupIntentOfSession: jest.fn(),
    retrieveSetupIntent: jest.fn(),
    placeHold: jest.fn(),
    capture: jest.fn().mockResolvedValue({}),
    cancelHold: jest.fn().mockResolvedValue({}),
    refund: jest.fn().mockResolvedValue({ id: 're_test' }),
    instantPayout: jest.fn().mockResolvedValue({ id: 'po_test', status: 'pending' }),
    refundInstantFee: jest.fn(),
    reverseTransfer: jest.fn().mockResolvedValue({ id: 'trr_test' }),
  };
  const notifications = { notify: jest.fn().mockResolvedValue({ id: randomUUID() }) };
  const brevo = {
    templates: { groceriesNotice: 42 },
    sendTemplate: jest.fn().mockResolvedValue({ sent: true, messageId: '<msg-1@brevo>' }),
  };
  const audit = { record: jest.fn() };
  const documents = {
    mandatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF mandate')),
  };
  const storage = {
    buildPath: (prefix: string, type: string, id: string) => `${prefix}/${type}/${id}`,
    statObject: jest.fn().mockResolvedValue({ sizeBytes: 1000, mimeType: 'image/jpeg' }),
    assertAcceptable: jest.fn(),
    createUploadUrl: jest.fn(),
    createDownloadUrl: jest.fn(),
  };

  const ids = {
    client: '',
    chef: '',
    admin: '',
    chefProfile: '',
    offer: '',
    booking: '',
  };
  const tag = randomUUID().slice(0, 8);
  const users = {
    findByClerkId: (clerk: string) =>
      prisma.user.findUnique({ where: { clerkUserId: clerk } }),
    ensurePersistedFromClerk: (clerk: string) =>
      prisma.user.findUniqueOrThrow({ where: { clerkUserId: clerk } }),
    chefIdentity: async () => ({ userId: ids.chef, chefProfileId: ids.chefProfile }),
  };

  beforeAll(async () => {
    const config = new ConfigService({ supabase: { dbUrl: DB } });
    prisma = new PrismaService(config);
    await prisma.$connect();
    service = new GroceriesService(
      prisma,
      users as never,
      stripe as unknown as GroceriesStripe,
      notifications as never,
      documents as never,
      storage as never,
      brevo as never,
      audit as never,
      new ConfigService({}),
    );
    const client = await prisma.user.create({
      data: {
        clerkUserId: `cl_${tag}`,
        email: `client-${tag}@test.fr`,
        fullName: 'Sophie Test',
      },
    });
    const chef = await prisma.user.create({
      data: { clerkUserId: `ch_${tag}`, email: `chef-${tag}@test.fr` },
    });
    const admin = await prisma.user.create({
      data: { clerkUserId: `ad_${tag}`, email: `admin-${tag}@test.fr`, role: 'admin' },
    });
    const profile = await prisma.chefProfile.create({
      data: {
        userId: chef.id,
        displayName: 'Chef Test',
        stripeAccountId: 'acct_test',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    });
    const offer = await prisma.serviceOffer.create({
      data: {
        chefProfileId: profile.id,
        name: 'Batch cooking 4 repas',
        durationMinutes: 180,
        priceCents: 15_000,
        shoppingIncluded: true,
      },
    });
    Object.assign(ids, {
      client: client.id,
      chef: chef.id,
      admin: admin.id,
      chefProfile: profile.id,
      offer: offer.id,
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    const bookings = await prisma.booking.findMany({
      where: { clientId: ids.client },
      select: { id: true },
    });
    const bookingIds = bookings.map((b) => b.id);
    await prisma.groceryRun.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.serviceOffer.deleteMany({ where: { id: ids.offer } });
    await prisma.chefProfile.deleteMany({ where: { id: ids.chefProfile } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.client, ids.chef, ids.admin] } },
    });
    await prisma.$disconnect();
  });

  /** A confirmed prestation `inHours` from now, mandate accepted, forfait 15 €. */
  async function booking(inHours: number) {
    const startsAt = new Date(Date.now() + inHours * H);
    const row = await prisma.booking.create({
      data: {
        reference: `LF-IT-${randomUUID().slice(0, 6)}`,
        clientId: ids.client,
        chefProfileId: ids.chefProfile,
        serviceOfferId: ids.offer,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * H),
        status: 'confirmed',
        priceCents: 16_500,
        amountTtc: 16_500,
        shoppingFeeCents: 1_500,
        deboursMandateAcceptedAt: new Date(),
      },
    });
    return row;
  }

  async function savedCard(bookingId: string) {
    await service.startCard(
      `cl_${tag}`,
      bookingId,
      { ip: '203.0.113.7', userAgent: 'jest' },
      {
        successUrl: 'http://localhost:3005/espace-client/commandes/x',
        cancelUrl: 'http://localhost:3005/espace-client/commandes/x',
      },
    );
    stripe.setupIntentOfSession.mockResolvedValue({
      id: 'seti_test',
      status: 'succeeded',
      payment_method: {
        id: 'pm_test',
        card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
      },
    });
  }

  it('records the mandate proof with the ceiling as Budget, and holds it once at the lock', async () => {
    const b = await booking(60);
    await savedCard(b.id);
    await service.confirmCard(`cl_${tag}`, b.id, 'cs_test');
    let run = await prisma.groceryRun.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(run).toMatchObject({
      status: 'card_saved',
      budgetCents: 10_000,
      mandateVersion: '2.0',
      mandateIp: '203.0.113.7',
      cardLast4: '4242',
    });
    expect(run.mandateDocumentSha256).toMatch(/^[a-f0-9]{64}$/);

    // Before the lock (T-48h), nothing.
    expect(await service.placeDueHolds(new Date())).toBe(0);

    stripe.placeHold.mockResolvedValue({
      ok: true,
      intent: { id: `pi_${tag}_1` },
      captureBefore: null,
    });
    const atLock = new Date(b.startsAt.getTime() - 47 * H);
    // Two runs of the clock at once: one hold.
    const [first, second] = await Promise.all([
      service.placeDueHolds(atLock),
      service.placeDueHolds(atLock),
    ]);
    expect(first + second).toBe(1);
    expect(stripe.placeHold).toHaveBeenCalledTimes(1);
    expect(stripe.placeHold).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 10_000 }),
    );
    // And again after a « restart »: still one.
    expect(await service.placeDueHolds(atLock)).toBe(0);
    run = await prisma.groceryRun.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(run.status).toBe('hold_placed');
    const hold = await prisma.payment.findUniqueOrThrow({
      where: { id: run.holdPaymentId! },
    });
    expect(hold).toMatchObject({
      purpose: 'courses',
      status: 'pending',
      amountTtc: 10_000,
    });
    // Never a commission on a courses payment.
    expect(await prisma.commission.count({ where: { paymentId: hold.id } })).toBe(0);
  });

  it('runs the notice, the receipts, the capture of the exact total and a contest', async () => {
    const b = await booking(30);
    await savedCard(b.id);
    stripe.placeHold.mockResolvedValue({
      ok: true,
      intent: { id: `pi_${tag}_2` },
      captureBefore: null,
    });
    await service.confirmCard(`cl_${tag}`, b.id, 'cs_test');
    expect(
      (await prisma.groceryRun.findUniqueOrThrow({ where: { bookingId: b.id } })).status,
    ).toBe('hold_placed');

    const now = Date.now();
    await service.sendNotice(`ch_${tag}`, b.id, {
      shoppingAt: new Date(now + 10 * H),
      cancelDeadline: new Date(now + 3 * H),
    });
    expect(brevo.sendTemplate).toHaveBeenCalled();
    // Brevo says the e-mail was delivered; the silence is off: the client must click.
    await service.handleBrevoEvent({ event: 'delivered', 'message-id': '<msg-1@brevo>' });
    expect(await service.handleDeadlines(new Date(now + 4 * H))).toBe(1);
    let run = await prisma.groceryRun.findUniqueOrThrow({
      where: { bookingId: b.id },
      include: { lines: true },
    });
    expect(run.status).toBe('awaiting_client');
    await service.confirm(`cl_${tag}`, b.id);

    // Above the Budget: refused.
    await expect(
      service.submitReceipts(`ch_${tag}`, b.id, {
        receipts: [{ uploadId: 'up_a', purchasedAt: new Date(now - H) }],
        lines: [{ label: 'Tout', amountCents: 10_001, receipt: 0 }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'GROCERIES_ABOVE_MANDATE' }),
    });

    await service.submitReceipts(`ch_${tag}`, b.id, {
      receipts: [{ uploadId: 'up_b', purchasedAt: new Date(now - H) }],
      lines: [
        { label: 'Poulet', amountCents: 2_400, receipt: 0 },
        { label: 'Épices', amountCents: 600, receipt: 0 },
        { label: 'Herbes sans ticket', amountCents: 300, receipt: null },
      ],
    });
    run = await prisma.groceryRun.findUniqueOrThrow({
      where: { bookingId: b.id },
      include: { lines: true },
    });
    const epices = run.lines.find((l) => l.label === 'Épices')!;
    await service.contestLine(`cl_${tag}`, b.id, epices.id, 'Pas sur ma liste');

    // 24 h after the deposit: one capture of the lines with a receipt (contested included).
    expect(await service.captureDue(new Date(now + 25 * H))).toBe(1);
    expect(stripe.capture).toHaveBeenCalledWith(`pi_${tag}_2`, 3_000, 0, run.id);
    expect(await service.captureDue(new Date(now + 26 * H))).toBe(0);
    run = await prisma.groceryRun.findUniqueOrThrow({
      where: { bookingId: b.id },
      include: { lines: true },
    });
    expect(run).toMatchObject({
      status: 'captured',
      capturedCents: 3_000,
      releasedCents: 7_000,
    });

    // The contest upheld: refunded, taken back from the chef's transfer.
    await service.decideLine(`ad_${tag}`, b.id, epices.id, { decision: 'upheld' });
    expect(stripe.refund).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 600 }),
    );
    // After 48 h, contests are closed; the run settles.
    const later = new Date(now + 49 * H);
    const herbes = run.lines.find((l) => l.label === 'Herbes sans ticket')!;
    await expect(
      (async () => {
        const closes = (
          await prisma.groceryRun.findUniqueOrThrow({ where: { id: run.id } })
        ).contestClosesAt!;
        jest.useFakeTimers({
          now: new Date(closes.getTime() + 1),
          doNotFake: ['nextTick', 'setImmediate'],
        });
        try {
          return await service.contestLine(`cl_${tag}`, b.id, herbes.id, 'trop tard');
        } finally {
          jest.useRealTimers();
        }
      })(),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'GROCERY_CONTEST_CLOSED' }),
    });
    expect(await service.settleDue(later)).toBeGreaterThanOrEqual(1);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: run.holdPaymentId! },
    });
    expect(payment).toMatchObject({ purpose: 'courses', refundedAmount: 600 });
    expect(await prisma.paymentInvoice.count({ where: { paymentId: payment.id } })).toBe(
      0,
    );
  });

  it('cancels late: the hold is released, the client shops, an unpaid forfait leaves', async () => {
    const b = await booking(30);
    await savedCard(b.id);
    stripe.placeHold.mockResolvedValue({
      ok: true,
      intent: { id: `pi_${tag}_3` },
      captureBefore: null,
    });
    await service.confirmCard(`cl_${tag}`, b.id, 'cs_test');
    await service.cancel(`cl_${tag}`, b.id, 'Je ferai les courses');
    expect(stripe.cancelHold).toHaveBeenCalledWith(`pi_${tag}_3`, expect.any(String));
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after).toMatchObject({
      shoppingByClient: true,
      shoppingFeeCents: 0,
      amountTtc: 15_000,
    });
  });

  it('refuses a Budget above the ceiling at the database too', async () => {
    const b = await booking(80);
    await savedCard(b.id);
    const run = await prisma.groceryRun.findUniqueOrThrow({ where: { bookingId: b.id } });
    await expect(
      prisma.groceryRun.update({
        where: { id: run.id },
        data: { capturedCents: 10_001 },
      }),
    ).rejects.toThrow();
  });
});
