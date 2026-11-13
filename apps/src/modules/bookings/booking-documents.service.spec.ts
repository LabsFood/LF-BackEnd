import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingWithdrawalsService } from './booking-withdrawals.service';
import { BookingsMailer } from './bookings.mailer';
import * as documents from './contract-documents';

const NOW = new Date('2026-12-01T09:00:00.000Z');
const CGV_BYTES = Buffer.from('%PDF-cgv');
const FORM_BYTES = Buffer.from('%PDF-form');

const LEGAL = {
  legalName: 'Marie Dupont EI',
  legalStatus: 'micro_entreprise',
  siren: '443061841',
  businessAddress: null,
  vatRegime: 'franchise',
  vatNumber: null,
  insurerName: null,
  insuranceCoverage: null,
  mediatorName: null,
  mediatorUrl: null,
  sapDeclarationNumber: null,
  sapProfile: null,
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  reference: 'LF-2026-0042',
  status: 'confirmed',
  startsAt: new Date('2026-12-20T08:00:00.000Z'),
  timeSlot: '09:00-12:00',
  persons: 4,
  addressLine: '3 rue des Lilas',
  addressCity: 'Montreuil',
  addressPostalCode: '93100',
  priceCents: 12_000,
  amountTtc: 12_000,
  createdAt: new Date('2026-11-29T09:00:00.000Z'),
  concludedAt: new Date('2026-11-30T09:00:00.000Z'),
  contractVersion: '1.0',
  deboursMandateAcceptedAt: null,
  earlyExecutionRequestedAt: null,
  client: { email: 'sophie@example.com', fullName: 'Sophie Martin' },
  chefProfile: { displayName: 'Chef Marie', ...LEGAL },
  serviceOffer: { name: 'Session 3 h' },
  formule: null,
  quote: null,
  bookingMeals: [{ meal: { name: 'Dahl de lentilles' } }],
  shoppingList: null,
  ...over,
});

describe('BookingDocumentsService', () => {
  let prisma: {
    booking: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    payment: { aggregate: jest.Mock };
  };
  let mailer: { contractClient: jest.Mock };
  let withdrawals: { acknowledge: jest.Mock };
  let audit: { record: jest.Mock };
  let service: BookingDocumentsService;

  beforeEach(() => {
    jest.spyOn(documents, 'cgvPdf').mockResolvedValue(CGV_BYTES);
    // The PDFs themselves are covered by contract-documents.spec.ts.
    jest.spyOn(documents, 'renderWithdrawalFormPdf').mockResolvedValue(FORM_BYTES);
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(booking()),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountTtc: 12_000 } }),
      },
    };
    mailer = { contractClient: jest.fn().mockResolvedValue({ sent: true }) };
    withdrawals = { acknowledge: jest.fn().mockResolvedValue(true) };
    audit = { record: jest.fn() };
    service = new BookingDocumentsService(
      prisma as unknown as PrismaService,
      {
        ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
      } as unknown as UsersService,
      mailer as unknown as BookingsMailer,
      withdrawals as unknown as BookingWithdrawalsService,
      audit as unknown as AuditService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  describe('file', () => {
    it('hands the client the CGV they accepted', async () => {
      const file = await service.file('clerk_1', 'booking-1', 'cgv');

      expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({
        id: 'booking-1',
        clientId: 'client-1',
      });
      expect(documents.cgvPdf).toHaveBeenCalledWith('1.0');
      expect(file).toEqual({ filename: 'CGV-LabsFood-v1.0.pdf', bytes: CGV_BYTES });
    });

    it('builds the withdrawal form on demand', async () => {
      const file = await service.file('clerk_1', 'booking-1', 'withdrawal-form');

      expect(file).toEqual({
        filename: 'formulaire-retractation-LF-2026-0042.pdf',
        bytes: FORM_BYTES,
      });
      expect(documents.renderWithdrawalFormPdf).toHaveBeenCalledWith({
        reference: 'LF-2026-0042',
        chefName: 'Marie Dupont EI',
        bookedOn: new Date('2026-11-29T09:00:00.000Z'),
        clientName: 'Sophie Martin',
        clientAddress: '3 rue des Lilas, 93100 Montreuil',
      });
    });

    it('has no débours mandate when the client never accepted one', async () => {
      await expect(
        service.file('clerk_1', 'booking-1', 'debours-mandate'),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'DOCUMENT_NOT_FOUND' },
      });
    });

    it('is a 404 on someone else’s booking', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);
      await expect(service.file('clerk_1', 'booking-1', 'cgv')).rejects.toMatchObject({
        response: { code: 'BOOKING_NOT_FOUND' },
      });
    });
  });

  describe('sendContracts', () => {
    it('sends each concluded V1 contract once, with the CGV and the form attached', async () => {
      prisma.booking.findMany
        .mockResolvedValueOnce([booking()])
        .mockResolvedValueOnce([]);

      await expect(service.sendContracts(NOW)).resolves.toEqual({
        sent: 1,
        acknowledged: 0,
      });

      expect(prisma.booking.findMany.mock.calls[0][0].where).toMatchObject({
        contractVersion: { not: null },
        contractMailSentAt: null,
        withdrawnAt: null,
        concludedAt: { not: null, gte: new Date('2026-11-24T09:00:00.000Z') },
      });
      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: { id: 'booking-1', contractMailSentAt: null },
        data: { contractMailSentAt: NOW },
      });
      const sent = mailer.contractClient.mock.calls[0][0];
      expect(sent).toMatchObject({
        reference: 'LF-2026-0042',
        title: 'Session 3 h',
        address: '3 rue des Lilas, 93100 Montreuil',
        priceCents: 12_000,
        chefName: 'Marie Dupont EI',
        // 30 November → 14 December, a Monday.
        withdrawalUntil: new Date('2026-12-14T22:59:59.999Z'),
        earlyExecution: false,
      });
      expect(sent.chefIdentity).toContain('SIREN 443061841');
      expect(sent.files.map((f: { name: string }) => f.name)).toEqual([
        'CGV-LabsFood-v1.0.pdf',
        'formulaire-retractation-LF-2026-0042.pdf',
      ]);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.contract_sent',
          subjectId: 'booking-1',
        }),
      );
    });

    it('skips a contract another instance claimed', async () => {
      prisma.booking.findMany
        .mockResolvedValueOnce([booking()])
        .mockResolvedValueOnce([]);
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.sendContracts(NOW)).resolves.toEqual({
        sent: 0,
        acknowledged: 0,
      });
      expect(mailer.contractClient).not.toHaveBeenCalled();
    });

    it('gives the claim back when the email did not go, or the CGV file is missing', async () => {
      prisma.booking.findMany
        .mockResolvedValueOnce([booking(), booking({ id: 'booking-2' })])
        .mockResolvedValueOnce([]);
      mailer.contractClient.mockResolvedValueOnce({ sent: false });
      jest.spyOn(documents, 'cgvPdf').mockRejectedValueOnce(new Error('ENOENT'));

      await expect(service.sendContracts(NOW)).resolves.toEqual({
        sent: 0,
        acknowledged: 0,
      });
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { contractMailSentAt: null },
      });
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-2' },
        data: { contractMailSentAt: null },
      });
    });

    it('tries again the withdrawal acknowledgements that did not go', async () => {
      const withdrawn = booking({
        status: 'cancelled',
        withdrawnAt: new Date('2026-11-30T18:00:00.000Z'),
        withdrawalDueCents: 0,
      });
      prisma.booking.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([withdrawn]);

      await expect(service.sendContracts(NOW)).resolves.toEqual({
        sent: 0,
        acknowledged: 1,
      });
      expect(withdrawals.acknowledge).toHaveBeenCalledWith(
        withdrawn,
        new Date('2026-11-30T18:00:00.000Z'),
        { dueCents: 0, refundCents: 12_000 },
      );
    });
  });
});
