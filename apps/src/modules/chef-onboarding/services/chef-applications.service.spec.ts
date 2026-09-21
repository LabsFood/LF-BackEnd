import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateChefApplicationDto } from '../dto/create-chef-application.dto';
import { mintApplicationToken } from './application-token';
import { ChefApplicationsService } from './chef-applications.service';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';

/** The flow document's own example body (FLOW-01 §2), used as the valid baseline. */
const validPayload = (): CreateChefApplicationDto =>
  JSON.parse(
    JSON.stringify({
      identity: {
        firstName: 'Marie',
        lastName: 'Dupont',
        email: 'marie.dupont@exemple.fr',
        phone: '+33612345678',
      },
      address: {
        street: '12 rue des Lilas',
        line2: null,
        postcode: '69003',
        city: 'Lyon',
        country: 'FR',
      },
      interventionZones: [
        {
          regionCode: '84',
          regionLabel: 'Auvergne-Rhône-Alpes',
          scope: 'cities',
          cities: [{ name: 'Lyon', dept: '69', insee: '69123' }],
        },
      ],
      workAuthorization: {
        status: 'other',
        details: 'Étudiante étrangère autorisée à travailler à temps partiel',
      },
      company: {
        legalForm: 'micro',
        siret: '44306184100047',
        sap: { path: 'type-a', declarationNumber: 'SAP443061841' },
      },
      consent: {
        privacyPolicy: true,
        terms: true,
        acceptedAt: '2026-09-20T09:12:00.000Z',
      },
    }),
  );

describe('ChefApplicationsService', () => {
  let service: ChefApplicationsService;
  let prisma: {
    chefApplication: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let mailer: {
    applicationReceived: jest.Mock;
    applicationReceivedAdmin: jest.Mock;
    completionUrl: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      chefApplication: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(41),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'app-1',
          submittedAt: new Date('2026-09-20T09:12:03.412Z'),
          status: 'submitted',
          ...data,
        })),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    mailer = {
      applicationReceived: jest.fn().mockResolvedValue({ sent: true }),
      applicationReceivedAdmin: jest.fn().mockResolvedValue({ sent: true }),
      completionUrl: jest.fn(
        () => 'https://labsfood.fr/candidature/app-1/documents?token=x',
      ),
    };

    service = new ChefApplicationsService(
      prisma as unknown as PrismaService,
      { record: jest.fn(), failed: jest.fn() } as unknown as AuditService,
      mailer as unknown as ChefOnboardingMailer,
    );
  });

  const submit = (mutate: (p: CreateChefApplicationDto) => void = () => {}) => {
    const payload = validPayload();
    mutate(payload);
    return service.submit(payload);
  };

  const expectRejected = async (mutate: (p: CreateChefApplicationDto) => void) => {
    await expect(submit(mutate)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.chefApplication.create).not.toHaveBeenCalled();
  };

  describe('the happy path', () => {
    it('accepts the flow document’s own example body', async () => {
      const result = await submit();
      expect(result.reference).toBe('APP-2026-0042');
      expect(result.completionUrl).toContain('token=');
    });

    it('creates no user and no Clerk account', async () => {
      await submit();
      // The only write is the candidature itself.
      expect(prisma.chefApplication.create).toHaveBeenCalledTimes(1);
      expect(Object.keys(prisma)).not.toContain('clerk');
    });

    it('stores only a hash of the candidate token', async () => {
      await submit();
      const { data } = prisma.chefApplication.create.mock.calls[0][0];
      expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data).not.toHaveProperty('token');
    });

    it('lower-cases the email so the uniqueness index cannot be sidestepped by case', async () => {
      await submit((p) => {
        p.identity.email = 'Marie.Dupont@Exemple.FR';
      });
      expect(prisma.chefApplication.create.mock.calls[0][0].data.email).toBe(
        'marie.dupont@exemple.fr',
      );
    });

    it('keeps the consent timestamp verbatim as proof', async () => {
      await submit();
      const { data } = prisma.chefApplication.create.mock.calls[0][0];
      expect(data.consentAcceptedAt).toEqual(new Date('2026-09-20T09:12:00.000Z'));
    });

    it('returns the computed document list rather than anything the client sent', async () => {
      const result = await submit();
      // Kebab-case, exactly as the flow document's 201 response lists them.
      expect(result.documents.map((d) => d.type)).toEqual([
        'identity',
        'status-proof',
        'registration',
        'sap-declaration',
        'rc-pro',
        'haccp',
        'ddpp',
      ]);
      expect(result.documents.every((d) => d.status === 'missing')).toBe(true);
    });
  });

  describe('email uniqueness', () => {
    it('refuses when an open candidature already holds the address', async () => {
      prisma.chefApplication.findFirst.mockResolvedValue({ id: 'other' });
      await expect(submit()).rejects.toMatchObject({
        response: { code: 'EMAIL_ALREADY_USED' },
      });
    });

    it('refuses when the address is already a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      await expect(submit()).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cross-field validation (FLOW-01 §2)', () => {
    it('refuses an overseas postcode — metropolitan France only', () =>
      expectRejected((p) => {
        p.address.postcode = '97400';
      }));

    it('refuses a region code outside the metropolitan reference list', () =>
      expectRejected((p) => {
        p.interventionZones[0].regionCode = '01';
      }));

    it('refuses scope "cities" with an empty city list', () =>
      expectRejected((p) => {
        p.interventionZones[0].cities = [];
      }));

    it('refuses work authorisation "other" without details', () =>
      expectRejected((p) => {
        p.workAuthorization.details = null;
      }));

    it('refuses details shorter than 10 characters', () =>
      expectRejected((p) => {
        p.workAuthorization.details = 'court';
      }));

    it('refuses details supplied alongside a status that forbids them', () =>
      expectRejected((p) => {
        p.workAuthorization.status = 'eu-citizen';
        p.workAuthorization.details = 'Ressortissant français';
      }));

    it('refuses a SIRET that fails the Luhn key', () =>
      expectRejected((p) => {
        p.company.siret = '44306184100048';
      }));

    it('refuses a missing SIRET for a registered company', () =>
      expectRejected((p) => {
        p.company.siret = null;
      }));

    it('refuses a SIRET from a candidate who says they have no company', () =>
      expectRejected((p) => {
        p.company.legalForm = 'not-registered';
      }));

    it('accepts an unregistered candidate with no SIRET', async () => {
      const result = await submit((p) => {
        p.company.legalForm = 'not-registered';
        p.company.siret = null;
      });
      // No registration document is demanded of someone with no company.
      expect(result.documents.map((d) => d.type)).not.toContain('registration');
    });

    it('refuses a malformed SAP number on the type-a route', () =>
      expectRejected((p) => {
        p.company.sap.declarationNumber = 'SAP123';
      }));

    it('refuses a SAP number on the type-b route', () =>
      expectRejected((p) => {
        p.company.sap.path = 'type-b';
      }));

    it.each([
      [
        'privacyPolicy',
        (p: CreateChefApplicationDto) => (p.consent.privacyPolicy = false),
      ],
      ['terms', (p: CreateChefApplicationDto) => (p.consent.terms = false)],
    ])('refuses when consent.%s is not given', (_name, mutate) => expectRejected(mutate));
  });

  describe('resolveByToken', () => {
    const stored = () => mintApplicationToken();

    it('returns the candidature for its own live token', async () => {
      const { token, tokenHash, expiresAt } = stored();
      prisma.chefApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        tokenHash,
        tokenExpiresAt: expiresAt,
      });
      await expect(service.resolveByToken('app-1', token)).resolves.toMatchObject({
        id: 'app-1',
      });
    });

    it('answers 401 TOKEN_INVALID for a wrong token, not 409', async () => {
      const { tokenHash, expiresAt } = stored();
      prisma.chefApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        tokenHash,
        tokenExpiresAt: expiresAt,
      });
      await expect(service.resolveByToken('app-1', 'wrong')).rejects.toMatchObject({
        status: 401,
        response: { code: 'TOKEN_INVALID' },
      });
    });

    it('answers 401 TOKEN_EXPIRED past the expiry, as the flow document specifies', async () => {
      const { token, tokenHash } = stored();
      prisma.chefApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        tokenHash,
        tokenExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.resolveByToken('app-1', token)).rejects.toMatchObject({
        status: 401,
        response: { code: 'TOKEN_EXPIRED' },
      });
    });

    it('rejects a revoked token — the hash is nulled at the decision', async () => {
      const { token } = stored();
      prisma.chefApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        tokenHash: null,
        tokenExpiresAt: null,
      });
      await expect(service.resolveByToken('app-1', token)).rejects.toMatchObject({
        status: 401,
      });
    });
  });
});
