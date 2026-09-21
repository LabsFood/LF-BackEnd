import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  ChefApplication,
  ChefApplicationStatus,
  CompanyLegalForm,
  Prisma,
  SapPath,
  WorkAuthorizationStatus,
} from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateChefApplicationDto } from '../dto/create-chef-application.dto';
import {
  buildApplicationReference,
  fromWire,
  isValidPostcode,
  isMetropolitanRegion,
  isValidSapDeclarationNumber,
  isValidSiret,
  requiredDocuments,
  toWire,
} from '../domain/chef-onboarding.rules';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';
import {
  isExpired,
  mintApplicationToken,
  nextResendState,
  tokenMatches,
} from './application-token';

/** Statuses that still hold the candidate's email address (see the partial index). */
const UNDECIDED: ChefApplicationStatus[] = [
  ChefApplicationStatus.submitted,
  ChefApplicationStatus.changes_requested,
];

@Injectable()
export class ChefApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: ChefOnboardingMailer,
  ) {}

  /**
   * `POST /chef-applications` (FLOW-01 §2).
   *
   * Creates no user and no Clerk account: until an admin approves, the candidate is
   * a candidature holding a scoped token, nothing more.
   */
  async submit(payload: CreateChefApplicationDto, requestId?: string) {
    this.assertValid(payload);

    const email = payload.identity.email.trim().toLowerCase();
    await this.assertEmailFree(email);

    const { token, tokenHash, expiresAt } = mintApplicationToken();

    const application = await this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx);
      try {
        return await tx.chefApplication.create({
          data: {
            reference,
            firstName: payload.identity.firstName.trim(),
            lastName: payload.identity.lastName.trim(),
            email,
            phone: payload.identity.phone,
            addressStreet: payload.address.street,
            addressLine2: payload.address.line2 ?? null,
            addressPostcode: payload.address.postcode,
            addressCity: payload.address.city,
            addressCountry: payload.address.country ?? 'FR',
            interventionZones:
              payload.interventionZones as unknown as Prisma.InputJsonValue,
            workAuthorizationStatus: fromWire(
              payload.workAuthorization.status,
            ) as WorkAuthorizationStatus,
            workAuthorizationDetails: payload.workAuthorization.details?.trim() ?? null,
            companyLegalForm: fromWire(payload.company.legalForm) as CompanyLegalForm,
            companySiret: payload.company.siret ?? null,
            sapPath: fromWire(payload.company.sap.path) as SapPath,
            sapDeclarationNumber: payload.company.sap.declarationNumber ?? null,
            consentPrivacyPolicy: payload.consent.privacyPolicy,
            consentTerms: payload.consent.terms,
            consentAcceptedAt: new Date(payload.consent.acceptedAt),
            tokenHash,
            tokenExpiresAt: expiresAt,
          },
        });
      } catch (error) {
        // The partial unique index is the real guard — the pre-check above races.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException({
            code: 'EMAIL_ALREADY_USED',
            message: 'A candidature is already open for this email address.',
          });
        }
        throw error;
      }
    });

    await this.audit.record({
      actorType: 'candidate',
      action: 'application.submitted',
      subjectType: 'chef_application',
      subjectId: application.id,
      requestId,
      metadata: { reference: application.reference, city: application.addressCity },
    });

    await Promise.all([
      this.mailer.applicationReceived({
        email: application.email,
        firstName: application.firstName,
        reference: application.reference,
        applicationId: application.id,
        token,
      }),
      this.mailer.applicationReceivedAdmin({
        reference: application.reference,
        applicationId: application.id,
        name: `${application.firstName} ${application.lastName}`,
        city: application.addressCity,
      }),
    ]);

    return {
      ...this.toCandidateView(application),
      completionUrl: this.mailer.completionUrl(application.id, token),
    };
  }

  /**
   * Cross-field rules from the FLOW-01 §2 table. Single-field shapes are already
   * rejected by the `ValidationPipe`; what is left needs the whole body in view.
   */
  private assertValid(payload: CreateChefApplicationDto): void {
    const fail = (message: string): never => {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message });
    };

    if (!isValidPostcode(payload.address.postcode)) {
      fail('address.postcode must be a metropolitan French postcode (01000–95999).');
    }

    for (const zone of payload.interventionZones) {
      if (!isMetropolitanRegion(zone.regionCode)) {
        fail(
          `interventionZones: "${zone.regionCode}" is not a metropolitan region code.`,
        );
      }
      if (zone.scope === 'cities' && zone.cities.length === 0) {
        fail(
          `interventionZones[${zone.regionCode}] with scope "cities" needs at least one city.`,
        );
      }
    }

    const details = payload.workAuthorization.details?.trim() ?? '';
    if (payload.workAuthorization.status === 'other') {
      if (details.length < 10) {
        fail(
          'workAuthorization.details is required (10 characters minimum) when status is "other".',
        );
      }
    } else if (details.length > 0) {
      fail('workAuthorization.details is only accepted when status is "other".');
    }

    const siret = payload.company.siret?.trim() ?? '';
    if (payload.company.legalForm === 'not-registered') {
      if (siret)
        fail('company.siret is not accepted when legalForm is "not-registered".');
    } else if (!isValidSiret(siret)) {
      fail('company.siret is required and must be 14 digits with a valid Luhn key.');
    }

    const declaration = payload.company.sap.declarationNumber?.trim() ?? '';
    if (payload.company.sap.path === 'type-a') {
      if (!isValidSapDeclarationNumber(declaration)) {
        fail(
          'company.sap.declarationNumber must match SAP + 9 digits on the type-a route.',
        );
      }
    } else if (declaration.length > 0) {
      fail('company.sap.declarationNumber is only accepted on the type-a route.');
    }

    if (!payload.consent.privacyPolicy || !payload.consent.terms) {
      fail('Both consent.privacyPolicy and consent.terms must be accepted.');
    }
  }

  /**
   * An address may hold one live candidature, and must not already be a user
   * (FLOW-01 §2). Merging a client account into a chef account is out of scope.
   */
  private async assertEmailFree(email: string): Promise<void> {
    const [openApplication, existingUser] = await Promise.all([
      this.prisma.chefApplication.findFirst({
        where: { email, status: { in: UNDECIDED } },
        select: { id: true },
      }),
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
    ]);

    if (openApplication || existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_USED',
        message: 'This email address already has an account or an open candidature.',
      });
    }
  }

  /** `APP-2026-0042`, sequential within the calendar year. */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getUTCFullYear();
    const countThisYear = await tx.chefApplication.count({
      where: { reference: { startsWith: `APP-${year}-` } },
    });
    return buildApplicationReference(year, countThisYear + 1);
  }

  /** Resolves a candidature from a bearer token, or explains why it will not. */
  async resolveByToken(applicationId: string, token: string): Promise<ChefApplication> {
    const application = await this.prisma.chefApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Candidature not found.');

    // 401, not 409: the flow document specifies `401 TOKEN_EXPIRED`, and an
    // unusable credential is an authentication failure either way.
    if (!tokenMatches(token, application.tokenHash)) {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'This link is no longer valid.',
      });
    }
    if (isExpired(application.tokenExpiresAt)) {
      throw new UnauthorizedException({
        code: 'TOKEN_EXPIRED',
        message: 'This link has expired. Request a new one.',
      });
    }
    return application;
  }

  /** `POST /chef-applications/:id/resend-link` — 3 per rolling 24 h (FLOW-01 §4). */
  async resendLink(applicationId: string, requestId?: string) {
    const application = await this.prisma.chefApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Candidature not found.');

    if (!UNDECIDED.includes(application.status)) {
      throw new ConflictException({
        code: 'APPLICATION_DECIDED',
        message: 'This candidature has already been decided.',
      });
    }

    const resend = nextResendState(application);
    if (!resend) {
      throw new HttpException(
        {
          code: 'RESEND_LIMIT_REACHED',
          message: 'Three links have already been sent in the last 24 hours.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { token, tokenHash, expiresAt } = mintApplicationToken();
    await this.prisma.chefApplication.update({
      where: { id: applicationId },
      data: { tokenHash, tokenExpiresAt: expiresAt, ...resend },
    });

    await this.audit.record({
      actorType: 'candidate',
      action: 'application.link_resent',
      subjectType: 'chef_application',
      subjectId: applicationId,
      requestId,
      metadata: { resendCount: resend.resendCount },
    });

    // Always to the address on the candidature, never to one supplied by the caller.
    await this.mailer.applicationReceived({
      email: application.email,
      firstName: application.firstName,
      reference: application.reference,
      applicationId: application.id,
      token,
    });

    return { sentTo: application.email, expiresAt };
  }

  /**
   * What the candidate may see (FLOW-01 §4): their own dossier, and nothing
   * internal — no admin notes, no review queue position.
   */
  toCandidateView(application: ChefApplication) {
    return {
      id: application.id,
      reference: application.reference,
      status: toWire(application.status),
      submittedAt: application.submittedAt,
      // Kebab-case on the wire, as the flow document's 201 response specifies.
      documents: requiredDocuments({
        workAuthorizationStatus: application.workAuthorizationStatus,
        companyLegalForm: application.companyLegalForm,
        sapPath: application.sapPath,
      }).map((doc) => ({ ...doc, type: toWire(doc.type), status: 'missing' as const })),
    };
  }
}
