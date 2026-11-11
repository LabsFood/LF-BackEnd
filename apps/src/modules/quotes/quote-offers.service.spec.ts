import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../messaging/services/messaging.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { QuoteOffersService } from './quote-offers.service';
import { QuotesMailer } from './quotes.mailer';
import { QuotesService } from './quotes.service';

/** 1 December 2026: the CGV V1 are in force. */
const NOW = new Date('2026-12-01T09:00:00.000Z');

const OFFER = {
  id: 'offer-1',
  status: 'sent',
  chefProfileId: 'chef-1',
  validUntil: new Date('2026-12-08T09:00:00.000Z'),
  proposedDate: null,
  proposedTimeSlot: null,
  clientPriceCents: 18_000,
  afterTaxCreditCents: 9_000,
};

const quote = (desiredDate: string) => ({
  id: 'quote-1',
  reference: 'DEM-2026-0001',
  clientId: 'client-1',
  desiredDate: new Date(`${desiredDate}T00:00:00.000Z`),
  timeSlot: 'morning',
  persons: 4,
  addressLine: '12 rue des Lilas',
  addressPostalCode: '93100',
  addressCity: 'Montreuil',
  brief: null,
  offers: [OFFER],
});

describe('QuoteOffersService.accept — booking boxes (CGV V1)', () => {
  let tx: Record<string, Record<string, jest.Mock>>;
  let quotes: Record<string, jest.Mock>;
  let audit: { record: jest.Mock };
  let service: QuoteOffersService;

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'queueMicrotask',
      ],
    });
    tx = {
      quoteOffer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      serviceOffer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'custom-1' }),
        create: jest.fn(),
      },
      booking: { create: jest.fn().mockResolvedValue({ id: 'booking-1' }) },
      quote: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((work: (db: unknown) => unknown) => work(tx)),
    };
    quotes = {
      me: jest.fn().mockResolvedValue({ id: 'client-1' }),
      loadForClient: jest.fn().mockResolvedValue(quote('2027-01-20')),
      load: jest.fn().mockResolvedValue({}),
      view: jest.fn().mockReturnValue({}),
    };
    audit = { record: jest.fn() };
    service = new QuoteOffersService(
      prisma as unknown as PrismaService,
      quotes as unknown as QuotesService,
      {} as PlatformSettingsService,
      {} as MessagingService,
      {} as QuotesMailer,
      audit as unknown as AuditService,
      { get: jest.fn() } as unknown as ConfigService,
    );
    // The conversation and the emails that follow are not under test here.
    jest
      .spyOn(
        service as unknown as { afterAcceptance: () => Promise<void> },
        'afterAcceptance',
      )
      .mockResolvedValue(undefined);
  });
  afterEach(() => jest.useRealTimers());

  it('refuses an acceptance without the CGV box, creating nothing', async () => {
    await expect(service.accept('clerk_1', 'quote-1', 'offer-1')).rejects.toMatchObject({
      status: 422,
      response: { code: 'CONTRACT_CONSENT_REQUIRED', missing: ['CGV'] },
    });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it('asks for early execution when the prestation falls inside the 14 days', async () => {
    quotes.loadForClient.mockResolvedValue(quote('2026-12-05'));

    await expect(
      service.accept('clerk_1', 'quote-1', 'offer-1', { version: '1.0', cgv: true }),
    ).rejects.toMatchObject({ response: { missing: ['EARLY_EXECUTION'] } });
  });

  it('concludes the contract on acceptance, with the boxes stamped and audited', async () => {
    await service.accept('clerk_1', 'quote-1', 'offer-1', { version: '1.0', cgv: true });

    expect(tx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'confirmed',
          concludedAt: NOW,
          contractVersion: '1.0',
          cgvAcceptedAt: NOW,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'booking.consents', subjectId: 'booking-1' }),
    );
  });
});
