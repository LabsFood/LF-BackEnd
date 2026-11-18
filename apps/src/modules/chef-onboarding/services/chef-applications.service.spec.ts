import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';

import { ChefApplicationStatus, UserRole } from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { ClerkService } from '../../../integrations/clerk.service';
import { GeoService } from '../../../integrations/geo.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateChefApplicationByAdminDto,
  CreateChefApplicationDto,
} from '../dto/create-chef-application.dto';
import { UpdateChefApplicationDto } from '../dto/update-chef-application.dto';
import { ChefApplicationsService } from './chef-applications.service';
import { ChefDocumentsService } from './chef-documents.service';
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

/** geo.api.gouv.fr, as far as these tests go. */
const LYON = { nom: 'Lyon', code: '69123', codeDepartement: '69' };
const COMMUNES_BY_POSTCODE: Record<string, (typeof LYON)[]> = {
  '69003': [LYON],
  '93100': [{ nom: 'Montreuil', code: '93048', codeDepartement: '93' }],
};
const COMMUNES_BY_REGION: Record<string, (typeof LYON)[]> = { '84': [LYON] };

/** What Clerk returns as `url`: its own hosted page, which strands the person there. */
const CLERK_TICKET_URL = 'https://clerk.labsfood.fr/v1/tickets/accept?ticket=sit_secret';
/** What the email must carry instead: the site's sign-in page with the ticket. */
const SIGN_IN_URL =
  'https://batchcooking.labsfood.fr/auth/login?__clerk_ticket=sit_secret';

/** A candidature row as Prisma would return it after the example submission. */
const storedApplication = (over: Record<string, unknown> = {}) => ({
  id: 'app-1',
  reference: 'APP-2026-0042',
  status: ChefApplicationStatus.submitted,
  submittedAt: new Date('2026-09-20T09:12:03.412Z'),
  decidedAt: null,
  decisionReason: null,
  allowReapplyAfter: null,
  firstName: 'Marie',
  lastName: 'Dupont',
  email: 'marie.dupont@exemple.fr',
  phone: '+33612345678',
  addressStreet: '12 rue des Lilas',
  addressLine2: null,
  addressPostcode: '69003',
  addressCity: 'Lyon',
  addressCountry: 'FR',
  // Keys in jsonb's own order (shortest first), not in the order they were sent.
  interventionZones: [
    {
      scope: 'cities',
      cities: [{ dept: '69', name: 'Lyon', insee: '69123' }],
      regionCode: '84',
      regionLabel: 'Auvergne-Rhône-Alpes',
    },
  ],
  workAuthorizationStatus: 'other',
  workAuthorizationDetails: 'Étudiante étrangère autorisée à travailler à temps partiel',
  companyLegalForm: 'micro',
  companySiret: '44306184100047',
  sapPath: 'type_a',
  sapDeclarationNumber: 'SAP443061841',
  consentPrivacyPolicy: true,
  consentTerms: true,
  consentAcceptedAt: new Date('2026-09-20T09:12:00.000Z'),
  chefProfileId: 'cp-1',
  ...over,
});

describe('ChefApplicationsService', () => {
  let service: ChefApplicationsService;
  let prisma: {
    chefApplication: {
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    chefProfile: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    user: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let clerk: { configured: boolean; getClient: () => unknown };
  let clerkUsers: { createUser: jest.Mock; deleteUser: jest.Mock };
  let signInTokens: { createSignInToken: jest.Mock };
  let mailer: {
    applicationReceived: jest.Mock;
    applicationReceivedAdmin: jest.Mock;
    signInLink: jest.Mock;
    signInUrl: jest.Mock;
  };
  let audit: { record: jest.Mock; failed: jest.Mock };
  let documents: { dossier: jest.Mock; answersOf: jest.Mock; latestPerType: jest.Mock };
  let geo: GeoService & { communesByPostcode: jest.Mock; communesByRegion: jest.Mock };

  beforeEach(() => {
    prisma = {
      chefApplication: {
        count: jest.fn().mockResolvedValue(41),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'app-1',
          submittedAt: new Date('2026-09-20T09:12:03.412Z'),
          status: ChefApplicationStatus.submitted,
          decidedAt: null,
          ...data,
        })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...storedApplication(),
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chefProfile: {
        create: jest.fn().mockResolvedValue({ id: 'cp-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'u-1' }),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    clerkUsers = {
      createUser: jest.fn().mockResolvedValue({ id: 'user_2n' }),
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    signInTokens = {
      createSignInToken: jest
        .fn()
        .mockResolvedValue({ token: 'sit_secret', url: CLERK_TICKET_URL }),
    };
    clerk = {
      configured: true,
      getClient: () => ({ users: clerkUsers, signInTokens }),
    };
    mailer = {
      applicationReceived: jest.fn().mockResolvedValue({ sent: true }),
      applicationReceivedAdmin: jest.fn().mockResolvedValue({ sent: true }),
      signInLink: jest.fn().mockResolvedValue({ sent: true }),
      signInUrl: jest.fn(
        (ticket: string) =>
          `https://batchcooking.labsfood.fr/auth/login?__clerk_ticket=${ticket}`,
      ),
    };
    audit = { record: jest.fn(), failed: jest.fn() };
    documents = {
      dossier: jest.fn().mockResolvedValue({
        dossierStatus: 'draft',
        canApprove: false,
        documents: [],
      }),
      answersOf: jest.fn((a: Record<string, unknown>) => ({
        workAuthorizationStatus: a.workAuthorizationStatus,
        companyLegalForm: a.companyLegalForm,
        sapPath: a.sapPath,
      })),
      latestPerType: jest.fn().mockResolvedValue(new Map()),
    };
    // The real checks, over a stubbed base.
    geo = Object.assign(new GeoService(), {
      communesByPostcode: jest.fn(
        async (code: string) => COMMUNES_BY_POSTCODE[code] ?? [],
      ),
      communesByRegion: jest.fn(async (code: string) => COMMUNES_BY_REGION[code] ?? []),
    });

    service = new ChefApplicationsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      mailer as unknown as ChefOnboardingMailer,
      clerk as unknown as ClerkService,
      documents as unknown as ChefDocumentsService,
      geo,
    );
  });

  const submit = (mutate: (p: CreateChefApplicationDto) => void = () => {}) => {
    const payload = validPayload();
    mutate(payload);
    return service.submit(payload);
  };

  const expectRejected = async (mutate: (p: CreateChefApplicationDto) => void) => {
    await expect(submit(mutate)).rejects.toBeInstanceOf(UnprocessableEntityException);
    // Validation runs first: no account is created for a body that will be refused.
    expect(clerkUsers.createUser).not.toHaveBeenCalled();
    expect(prisma.chefApplication.create).not.toHaveBeenCalled();
  };

  describe('submission creates the account', () => {
    it('accepts the flow document’s own example body', async () => {
      const result = await submit();
      expect(result.reference).toBe('APP-2026-0042');
      expect(result.status).toBe('submitted');
    });

    it('creates the Clerk user with no password — the emailed link is the only way in', async () => {
      await submit();
      expect(clerkUsers.createUser).toHaveBeenCalledWith({
        emailAddress: ['marie.dupont@exemple.fr'],
        firstName: 'Marie',
        lastName: 'Dupont',
        skipPasswordRequirement: true,
        // The terms box of the form, so Clerk's legal consent check passes.
        legalAcceptedAt: new Date('2026-09-20T09:12:00.000Z'),
      });
    });

    it('writes the users row as a chef, tolerating the Clerk webhook having written it first', async () => {
      await submit();
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { clerkUserId: 'user_2n' },
        create: expect.objectContaining({
          clerkUserId: 'user_2n',
          email: 'marie.dupont@exemple.fr',
          role: UserRole.chef,
        }),
        update: expect.objectContaining({ role: UserRole.chef }),
      });
    });

    it('creates the chef profile unverified and inactive — browse-only until approval', async () => {
      await submit();
      const { data } = prisma.chefProfile.create.mock.calls[0][0];
      expect(data).toEqual({ userId: 'u-1', displayName: 'Marie Dupont', city: 'Lyon' });
      // The flags are left to their `false` column defaults, never set from here.
      expect(data).not.toHaveProperty('isVerified');
      expect(data).not.toHaveProperty('isActive');
    });

    it('links the candidature to that chef profile', async () => {
      await submit();
      expect(prisma.chefApplication.create.mock.calls[0][0].data.chefProfileId).toBe(
        'cp-1',
      );
    });

    it('mails a 7-day single-use sign-in link to the submitted address', async () => {
      await submit();
      expect(signInTokens.createSignInToken).toHaveBeenCalledWith({
        userId: 'user_2n',
        expiresInSeconds: 7 * 24 * 60 * 60,
      });
      expect(mailer.applicationReceived).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'marie.dupont@exemple.fr',
          signInUrl: SIGN_IN_URL,
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('builds the link on the site from the ticket, never from Clerk’s own page', async () => {
      await submit();
      expect(mailer.signInUrl).toHaveBeenCalledWith('sit_secret');
      expect(JSON.stringify(mailer.applicationReceived.mock.calls)).not.toContain(
        CLERK_TICKET_URL,
      );
    });

    it('says whether the sign-in email left', async () => {
      const result = await submit();
      expect(result.invitation).toEqual({
        delivered: true,
        sentAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
    });

    it('says so when the sign-in email did not leave', async () => {
      mailer.applicationReceived.mockResolvedValue({ sent: false });
      const result = await submit();
      expect(result.invitation).toMatchObject({ delivered: false, sentAt: null });
    });

    it('records a lost sign-in email against the candidature — it is the only way in', async () => {
      mailer.applicationReceived.mockResolvedValue({ sent: false });
      await submit();
      expect(audit.failed).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'application.sign_in_link_email',
          subjectId: 'app-1',
        }),
        expect.any(Error),
      );
    });

    it('records nothing failed when the sign-in email leaves', async () => {
      await submit();
      expect(audit.failed).not.toHaveBeenCalled();
    });

    it('never puts the sign-in link in the response — whoever submits must not get in', async () => {
      const result = await submit();
      const body = JSON.stringify(result);
      expect(body).not.toContain('sit_secret');
      expect(body).not.toContain('ticket');
    });

    it('lower-cases the email before creating anything', async () => {
      await submit((p) => {
        p.identity.email = 'Marie.Dupont@Exemple.FR';
      });
      expect(clerkUsers.createUser.mock.calls[0][0].emailAddress).toEqual([
        'marie.dupont@exemple.fr',
      ]);
      expect(prisma.chefApplication.create.mock.calls[0][0].data.email).toBe(
        'marie.dupont@exemple.fr',
      );
    });

    it('keeps the consent timestamp verbatim as proof', async () => {
      await submit();
      const { data } = prisma.chefApplication.create.mock.calls[0][0];
      expect(data.consentAcceptedAt).toEqual(new Date('2026-09-20T09:12:00.000Z'));
    });

    it('records the new account as the actor', async () => {
      await submit();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'application.submitted', actorUserId: 'u-1' }),
      );
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

    it('refuses with 503 and creates nothing when Clerk is not configured', async () => {
      clerk.configured = false;
      await expect(submit()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('an admin opens the candidature for the batch cooker', () => {
    const withoutConsent = (
      mutate: (p: CreateChefApplicationByAdminDto) => void = () => {},
    ) => {
      const { consent: _consent, ...body } = validPayload();
      mutate(body);
      return body as CreateChefApplicationByAdminDto;
    };
    const openFor = (mutate?: (p: CreateChefApplicationByAdminDto) => void) =>
      service.submitByAdmin(withoutConsent(mutate), 'admin-1', 'req-9');

    it('creates the account the way a submission does: Clerk user, chef row, unverified inactive profile', async () => {
      const result = await openFor();
      expect(result.reference).toBe('APP-2026-0042');
      expect(result.status).toBe('submitted');
      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ role: UserRole.chef }),
        }),
      );
      const { data } = prisma.chefProfile.create.mock.calls[0][0];
      expect(data).not.toHaveProperty('isVerified');
      expect(data).not.toHaveProperty('isActive');
    });

    it('skips Clerk’s legal check: nobody ticked the box, and none is claimed', async () => {
      await openFor();
      const sent = clerkUsers.createUser.mock.calls[0][0];
      expect(sent).toMatchObject({
        emailAddress: ['marie.dupont@exemple.fr'],
        skipPasswordRequirement: true,
        skipLegalChecks: true,
      });
      expect(sent).not.toHaveProperty('legalAcceptedAt');
    });

    it('records that the batch cooker consented to nothing, with the day it was opened', async () => {
      await openFor();
      const { data } = prisma.chefApplication.create.mock.calls[0][0];
      expect(data.consentPrivacyPolicy).toBe(false);
      expect(data.consentTerms).toBe(false);
      expect(data.consentAcceptedAt).toBeInstanceOf(Date);
    });

    it('mails the batch cooker their sign-in link, and does not mail the admins about it', async () => {
      const result = await openFor();
      expect(mailer.applicationReceived).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'marie.dupont@exemple.fr',
          signInUrl: SIGN_IN_URL,
        }),
      );
      expect(mailer.applicationReceivedAdmin).not.toHaveBeenCalled();
      expect(result.invitation).toMatchObject({ delivered: true });
      expect(JSON.stringify(result)).not.toContain('sit_secret');
    });

    it('records the admin as the actor, with the account it created', async () => {
      await openFor();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'admin',
          actorUserId: 'admin-1',
          action: 'application.opened_by_admin',
          subjectId: 'app-1',
          requestId: 'req-9',
          metadata: expect.objectContaining({ chefUserId: 'u-1' }),
        }),
      );
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'application.submitted' }),
      );
    });

    it('records a lost sign-in email against the candidature, as a failure of the admin’s action', async () => {
      mailer.applicationReceived.mockResolvedValue({ sent: false });
      const result = await openFor();
      expect(result.invitation).toMatchObject({ delivered: false, sentAt: null });
      expect(audit.failed).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'system',
          action: 'application.sign_in_link_email',
          subjectId: 'app-1',
        }),
        expect.any(Error),
      );
    });

    it('refuses an address that already has an account, before Clerk is called', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-9' });
      await expect(openFor()).rejects.toBeInstanceOf(ConflictException);
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
    });

    it('holds the answers to the same rules as a submission', async () => {
      await expect(
        openFor((p) => {
          p.address.postcode = '97100';
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
    });

    it('refuses with 503 and creates nothing when Clerk is not configured', async () => {
      clerk.configured = false;
      await expect(openFor()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.chefApplication.create).not.toHaveBeenCalled();
    });

    it('deletes the Clerk user and records the failure under the admin when the database write fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('db down'));
      await expect(openFor()).rejects.toThrow('db down');
      expect(clerkUsers.deleteUser).toHaveBeenCalledWith('user_2n');
      expect(audit.failed).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'admin', actorUserId: 'admin-1' }),
        expect.any(Error),
      );
    });

    it('still lets the batch cooker correct it later, though the stored consent is false', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue({
        id: 'cp-1',
        userId: 'u-1',
        isVerified: false,
        isActive: false,
        autoSuspendedAt: null,
        application: storedApplication({
          consentPrivacyPolicy: false,
          consentTerms: false,
        }),
      });
      await expect(
        service.update('user_2n', { company: validPayload().company } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('the body an admin sends', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const transform = (body: unknown) =>
      pipe.transform(body, { type: 'body', metatype: CreateChefApplicationByAdminDto });

    it('is the candidature form without the consent block', async () => {
      const { consent: _consent, ...body } = validPayload();
      await expect(transform(body)).resolves.toMatchObject({
        identity: { email: 'marie.dupont@exemple.fr' },
      });
    });

    it('refuses a consent block: an admin cannot give it for someone else', async () => {
      await expect(transform(validPayload())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('an address that already has an account', () => {
    it('is refused before Clerk is called, so nothing is attached to the existing account', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'someone' });
      await expect(submit()).rejects.toBeInstanceOf(ConflictException);
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('answers with the code and a generic message — no role, name or status', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'someone', role: 'client' });
      const error = await submit().catch((e: ConflictException) => e);
      expect((error as ConflictException).getResponse()).toEqual({
        code: 'EMAIL_ALREADY_USED',
        message: expect.any(String),
      });
    });

    it('is matched case-insensitively — older rows kept the address as typed', async () => {
      await submit();
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'marie.dupont@exemple.fr', mode: 'insensitive' } },
        select: { id: true },
      });
    });

    it('is refused the same way when only Clerk knows it', async () => {
      clerkUsers.createUser.mockRejectedValue({
        status: 422,
        errors: [{ code: 'form_identifier_exists', longMessage: 'That email is taken.' }],
      });
      await expect(submit()).rejects.toMatchObject({
        status: 409,
        response: { code: 'EMAIL_ALREADY_USED' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps any other Clerk refusal of the address to 422', async () => {
      clerkUsers.createUser.mockRejectedValue({
        status: 422,
        errors: [{ code: 'form_param_format_invalid', longMessage: 'Invalid email.' }],
      });
      await expect(submit()).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
    });
  });

  describe('compensation — no Clerk account is left without its rows', () => {
    it('deletes the Clerk user when the database transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('postgres exploded'));
      await expect(submit()).rejects.toThrow('postgres exploded');
      expect(clerkUsers.deleteUser).toHaveBeenCalledWith('user_2n');
      expect(audit.failed).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'application.submit',
          metadata: expect.objectContaining({ compensated: true }),
        }),
        expect.any(Error),
      );
      expect(mailer.applicationReceived).not.toHaveBeenCalled();
    });

    it('deletes the Clerk user when the sign-in link cannot be issued, before writing anything', async () => {
      signInTokens.createSignInToken.mockRejectedValue(new Error('clerk hiccup'));
      await expect(submit()).rejects.toThrow('clerk hiccup');
      expect(clerkUsers.deleteUser).toHaveBeenCalledWith('user_2n');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('still surfaces the original error when the cleanup itself fails, and says so in the audit', async () => {
      prisma.$transaction.mockRejectedValue(new Error('postgres exploded'));
      clerkUsers.deleteUser.mockRejectedValue(new Error('clerk also down'));
      await expect(submit()).rejects.toThrow('postgres exploded');
      // An orphaned Clerk user must be findable, not recorded as cleaned up.
      expect(audit.failed).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { clerkUserId: 'user_2n', compensated: false },
        }),
        expect.any(Error),
      );
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

  describe('address and towns against the official base (geo.api.gouv.fr)', () => {
    it('refuses a town the postcode does not serve, naming those it does', async () => {
      const refused = submit((p) => {
        p.address.postcode = '93100';
        p.address.city = 'Marseille';
      });
      await expect(refused).rejects.toMatchObject({
        status: 422,
        response: { code: 'ADDRESS_CITY_MISMATCH', communes: ['Montreuil'] },
      });
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
    });

    it('refuses a zone town that is not the commune of its INSEE code', async () => {
      const refused = submit((p) => {
        p.interventionZones[0].cities = [
          { name: 'Marseille', dept: '13', insee: '13055' },
        ];
      });
      await expect(refused).rejects.toMatchObject({
        status: 422,
        response: { code: 'ZONE_CITY_UNKNOWN' },
      });
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
    });

    it('does not look up a region taken whole', async () => {
      await submit((p) => {
        p.interventionZones = [
          { regionCode: '11', regionLabel: 'Île-de-France', scope: 'region', cities: [] },
        ];
      });
      expect(geo.communesByRegion).not.toHaveBeenCalled();
    });

    it('creates nothing when the base cannot be reached — nothing unchecked is stored', async () => {
      geo.communesByPostcode.mockRejectedValue(
        new BadGatewayException({ code: 'GEO_UNAVAILABLE', upstream: 'geo.api.gouv.fr' }),
      );
      await expect(submit()).rejects.toBeInstanceOf(BadGatewayException);
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
    });
  });

  describe('mine — the signed-in candidate’s view', () => {
    const profile = (over: Record<string, unknown> = {}) => ({
      id: 'cp-1',
      userId: 'u-1',
      isVerified: false,
      isActive: false,
      autoSuspendedAt: null,
      application: storedApplication(),
      ...over,
    });

    it('returns the candidature with its dossier', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(profile());
      const view = await service.mine('user_2n');
      expect(prisma.chefProfile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user: { clerkUserId: 'user_2n' } } }),
      );
      expect(view).toMatchObject({ reference: 'APP-2026-0042', dossierStatus: 'draft' });
      expect(view.refusal).toBeNull();
      // Read back in the shape it was sent in, ready to correct.
      expect(view.answers).toEqual(validPayload());
    });

    it('does not read a candidate awaiting approval as disabled', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(profile());
      await service.mine('user_2n');
      expect(documents.dossier).toHaveBeenCalledWith('cp-1', expect.anything(), {
        disabled: false,
      });
    });

    it('shows a refused candidate the reason and the reapply date', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(
        profile({
          application: storedApplication({
            status: ChefApplicationStatus.rejected,
            decidedAt: new Date('2026-09-25T10:00:00.000Z'),
            decisionReason: "Zone d'intervention non couverte pour l'instant.",
            allowReapplyAfter: new Date('2027-01-01'),
          }),
        }),
      );
      const view = await service.mine('user_2n');
      expect(view.status).toBe('rejected');
      expect(view.refusal).toEqual({
        reason: "Zone d'intervention non couverte pour l'instant.",
        allowReapplyAfter: '2027-01-01',
      });
    });

    it('answers 404 for an account with no candidature', async () => {
      await expect(service.mine('user_2n')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('reapply', () => {
    const refusedProfile = (over: Record<string, unknown> = {}) => ({
      id: 'cp-1',
      userId: 'u-1',
      user: { email: 'marie.dupont@exemple.fr' },
      application: storedApplication({
        status: ChefApplicationStatus.rejected,
        decisionReason: 'Pièces incomplètes.',
        allowReapplyAfter: new Date('2026-01-01'),
        ...over,
      }),
    });

    it('reopens the refused candidature with the new answers, clearing the decision', async () => {
      prisma.chefProfile.findFirst
        .mockResolvedValueOnce(refusedProfile())
        .mockResolvedValueOnce({
          ...refusedProfile(),
          application: storedApplication({ status: ChefApplicationStatus.submitted }),
        });
      documents.dossier.mockResolvedValue({
        dossierStatus: 'reviewing',
        canApprove: false,
        documents: [{ type: 'identity', status: 'valid' }],
      });
      const view = await service.reapply('user_2n', validPayload());

      const { where, data } = prisma.chefApplication.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'app-1' });
      expect(data).toMatchObject({
        status: ChefApplicationStatus.submitted,
        decidedAt: null,
        decidedByUserId: null,
        decisionReason: null,
        decisionReasonCode: null,
        allowReapplyAfter: null,
        companySiret: '44306184100047',
      });
      expect(view.status).toBe('submitted');
      // With the dossier as it stands, not an all-missing list: the documents
      // deposited before the refusal keep their statuses.
      expect(view.documents).toEqual([{ type: 'identity', status: 'valid' }]);
      expect(mailer.applicationReceivedAdmin).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'application.resubmitted',
          actorUserId: 'u-1',
        }),
      );
    });

    it('is open at any time when the refusal set no date', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(
        refusedProfile({ allowReapplyAfter: null }),
      );
      await expect(service.reapply('user_2n', validPayload())).resolves.toBeDefined();
    });

    it('refuses before the reapply date', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(
        refusedProfile({ allowReapplyAfter: new Date('2099-01-01') }),
      );
      await expect(service.reapply('user_2n', validPayload())).rejects.toMatchObject({
        status: 409,
        response: { code: 'REAPPLY_TOO_EARLY', allowReapplyAfter: '2099-01-01' },
      });
      expect(prisma.chefApplication.update).not.toHaveBeenCalled();
    });

    it('refuses a candidature that was not refused', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(
        refusedProfile({ status: ChefApplicationStatus.submitted }),
      );
      await expect(service.reapply('user_2n', validPayload())).rejects.toMatchObject({
        response: { code: 'APPLICATION_NOT_REJECTED' },
      });
    });

    it('refuses an address other than the account’s own', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(refusedProfile());
      const payload = validPayload();
      payload.identity.email = 'someone.else@exemple.fr';
      await expect(service.reapply('user_2n', payload)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.chefApplication.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an account with no candidature', async () => {
      await expect(service.reapply('user_2n', validPayload())).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('update — correcting a candidature that awaits a decision', () => {
    const pending = (over: Record<string, unknown> = {}) => ({
      id: 'cp-1',
      userId: 'u-1',
      isVerified: false,
      isActive: false,
      autoSuspendedAt: null,
      application: storedApplication(over),
    });
    const update = (body: Record<string, unknown>) =>
      service.update('user_2n', body as never, 'req-1');
    const zones = [
      { regionCode: '11', regionLabel: 'Île-de-France', scope: 'region', cities: [] },
    ];
    const renamed = { firstName: 'Maria', lastName: 'Dupont', phone: '+33612345678' };
    const written = () => prisma.chefApplication.updateMany.mock.calls[0][0];

    beforeEach(() => prisma.chefProfile.findFirst.mockResolvedValue(pending()));

    it('replaces the sections sent and keeps the rest, checking the status in the same write', async () => {
      const view = await update({ interventionZones: zones });
      expect(written().where).toEqual({
        id: 'app-1',
        status: {
          in: [ChefApplicationStatus.submitted, ChefApplicationStatus.changes_requested],
        },
      });
      expect(written().data).toMatchObject({
        interventionZones: zones,
        addressCity: 'Lyon',
        companySiret: '44306184100047',
        // The account's address and the consent proof stay exactly as they were.
        email: 'marie.dupont@exemple.fr',
        consentAcceptedAt: new Date('2026-09-20T09:12:00.000Z'),
      });
      expect(view).toMatchObject({ reference: 'APP-2026-0042', dossierStatus: 'draft' });
    });

    it('is open while an admin has asked for changes', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(
        pending({ status: ChefApplicationStatus.changes_requested }),
      );
      await update({ interventionZones: zones });
      expect(prisma.chefApplication.updateMany).toHaveBeenCalled();
    });

    it.each([ChefApplicationStatus.approved, ChefApplicationStatus.rejected])(
      'refuses a candidature already %s',
      async (status) => {
        prisma.chefProfile.findFirst.mockResolvedValue(pending({ status }));
        await expect(update({ interventionZones: zones })).rejects.toMatchObject({
          status: 409,
          response: { code: 'APPLICATION_DECIDED' },
        });
        expect(prisma.chefApplication.updateMany).not.toHaveBeenCalled();
      },
    );

    it('loses to a decision that lands in the meantime', async () => {
      prisma.chefApplication.updateMany.mockResolvedValue({ count: 0 });
      await expect(update({ identity: renamed })).rejects.toMatchObject({
        response: { code: 'APPLICATION_DECIDED' },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('lets an unregistered candidate register — the way out of awaiting-registration', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(
        pending({ companyLegalForm: 'not_registered', companySiret: null }),
      );
      await update({
        company: {
          legalForm: 'micro',
          siret: '44306184100047',
          sap: { path: 'type-a', declarationNumber: 'SAP443061841' },
        },
      });
      expect(written().data).toMatchObject({
        companyLegalForm: 'micro',
        companySiret: '44306184100047',
      });
    });

    it('checks a corrected address against the official base', async () => {
      await expect(
        update({
          address: { ...validPayload().address, postcode: '93100', city: 'Marseille' },
        }),
      ).rejects.toMatchObject({ response: { code: 'ADDRESS_CITY_MISMATCH' } });
      expect(prisma.chefApplication.updateMany).not.toHaveBeenCalled();
    });

    it('looks up only the sections sent — a stored address does not hold back a correction', async () => {
      await update({ identity: renamed });
      expect(geo.communesByPostcode).not.toHaveBeenCalled();
      expect(geo.communesByRegion).not.toHaveBeenCalled();
    });

    it('validates a section as a submission would', async () => {
      await expect(
        update({
          company: {
            legalForm: 'not-registered',
            siret: '44306184100047',
            sap: { path: 'type-b', declarationNumber: null },
          },
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.chefApplication.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a changed answer a validated document proves, naming the document', async () => {
      documents.latestPerType.mockResolvedValue(
        new Map([['identity', { status: 'valid' }]]),
      );
      await expect(update({ identity: renamed })).rejects.toMatchObject({
        status: 409,
        response: { code: 'ANSWER_LOCKED', documents: ['identity'] },
      });
      expect(prisma.chefApplication.updateMany).not.toHaveBeenCalled();
    });

    it('still lets the phone change once the identity document is validated', async () => {
      documents.latestPerType.mockResolvedValue(
        new Map([['identity', { status: 'valid' }]]),
      );
      await update({
        identity: { ...renamed, firstName: 'Marie', phone: '+33699999999' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { fullName: 'Marie Dupont', phone: '+33699999999' },
      });
    });

    it('carries a corrected name to the account and the profile, as submission set them', async () => {
      await update({ identity: renamed });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { fullName: 'Maria Dupont', phone: '+33612345678' },
      });
      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'cp-1' },
        data: { displayName: 'Maria Dupont', city: 'Lyon' },
      });
    });

    it('records which answers changed, never their values', async () => {
      await update({ identity: renamed });
      expect(audit.record).toHaveBeenCalledWith({
        actorType: 'candidate',
        actorUserId: 'u-1',
        action: 'application.updated',
        subjectType: 'chef_application',
        subjectId: 'app-1',
        requestId: 'req-1',
        metadata: { reference: 'APP-2026-0042', changed: ['firstName'] },
      });
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain('Maria');
    });

    it('writes nothing when the sections sent are the ones on file, whatever the key order', async () => {
      const { address, interventionZones } = validPayload();
      await update({ address, interventionZones });
      expect(prisma.chefApplication.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers 404 for an account with no candidature', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(null);
      await expect(update({})).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('resendSignInLink', () => {
    it('sends a fresh link to the account’s own address', async () => {
      prisma.user.findUnique.mockResolvedValue({
        clerkUserId: 'user_2n',
        email: 'marie.dupont@exemple.fr',
        fullName: 'Marie Dupont',
        role: UserRole.chef,
      });
      const result = await service.resendSignInLink('u-1', 'admin-1');
      expect(mailer.signInLink).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'marie.dupont@exemple.fr',
          firstName: 'Marie',
          signInUrl: SIGN_IN_URL,
        }),
      );
      expect(result).toMatchObject({
        sentTo: 'marie.dupont@exemple.fr',
        delivered: true,
      });
      // The admin gets confirmation, never the link itself.
      expect(JSON.stringify(result)).not.toContain('sit_secret');
    });

    it('tells the admin when the link did not leave, instead of claiming it was sent', async () => {
      prisma.user.findUnique.mockResolvedValue({
        clerkUserId: 'user_2n',
        email: 'marie.dupont@exemple.fr',
        fullName: 'Marie Dupont',
        role: UserRole.chef,
      });
      mailer.signInLink.mockResolvedValue({ sent: false });
      const result = await service.resendSignInLink('u-1', 'admin-1');
      expect(result.delivered).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'chef.invitation_resent', outcome: 'failed' }),
      );
    });

    it('answers 503 when Clerk is not configured', async () => {
      prisma.user.findUnique.mockResolvedValue({
        clerkUserId: 'user_2n',
        email: 'marie.dupont@exemple.fr',
        fullName: 'Marie Dupont',
        role: UserRole.chef,
      });
      clerk.configured = false;
      await expect(service.resendSignInLink('u-1', 'admin-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('refuses an account that is not a batch cooker', async () => {
      prisma.user.findUnique.mockResolvedValue({
        clerkUserId: 'user_9',
        email: 'client@exemple.fr',
        fullName: null,
        role: UserRole.client,
      });
      await expect(service.resendSignInLink('u-9', 'admin-1')).rejects.toMatchObject({
        response: { code: 'NOT_A_CHEF' },
      });
    });
  });
});

describe('UpdateChefApplicationDto under the global validation pipe', () => {
  // Mirrors `main.ts`, so this is what an actual `PATCH /me/chef-application` does.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const transform = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateChefApplicationDto });
  const identity = { firstName: 'Marie', lastName: 'Dupont', phone: '+33612345678' };

  it('accepts a single section', async () => {
    await expect(transform({ identity })).resolves.toMatchObject({ identity });
  });

  it('refuses to change the account address', async () => {
    await expect(
      transform({ identity: { ...identity, email: 'autre@exemple.fr' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to touch the consent proof', async () => {
    await expect(
      transform({
        consent: { privacyPolicy: true, terms: true, acceptedAt: '2026-10-03T00:00:00Z' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('wants a section whole, as at submission', async () => {
    await expect(transform({ identity: { firstName: 'Marie' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(transform({ interventionZones: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
