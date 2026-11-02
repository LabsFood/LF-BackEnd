import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';

import {
  ChefApplication,
  ChefApplicationStatus,
  CompanyLegalForm,
  Prisma,
  SapPath,
  UserRole,
  WorkAuthorizationStatus,
} from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { ClerkService } from '../../../integrations/clerk.service';
import { GeoService } from '../../../integrations/geo.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateChefApplicationDto,
  InterventionZoneDto,
} from '../dto/create-chef-application.dto';
import { UpdateChefApplicationDto } from '../dto/update-chef-application.dto';
import {
  buildApplicationReference,
  fromWire,
  isDisabledByAdmin,
  interventionZonesProblem,
  isValidPostcode,
  isValidSapDeclarationNumber,
  isValidSiret,
  lockingDocuments,
  requiredDocuments,
  toWire,
  UNDECIDED,
  zoneCitiesProblem,
} from '../domain/chef-onboarding.rules';
import { ChefDocumentsService } from './chef-documents.service';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';

/** FLOW-01 §6 — the sign-in link lasts 7 days and is single use. */
const SIGN_IN_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Says the address is taken and nothing else: no role, no name, no status. */
const EMAIL_ALREADY_USED = {
  code: 'EMAIL_ALREADY_USED',
  message: 'An account already exists for this email address. Sign in to continue.',
};

const APPLICATION_DECIDED = {
  code: 'APPLICATION_DECIDED',
  message: 'This candidature has been decided and can no longer be corrected.',
};

@Injectable()
export class ChefApplicationsService {
  private readonly logger = new Logger(ChefApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: ChefOnboardingMailer,
    private readonly clerk: ClerkService,
    private readonly documents: ChefDocumentsService,
    private readonly geo: GeoService,
  ) {}

  /**
   * `POST /chef-applications` (FLOW-01 §2) — public, and it creates the account: a
   * Clerk user, a `users` row, and a chef profile left unverified and inactive, so
   * the candidate is browse-only until an admin approves.
   *
   * The Clerk user has no password. The only way in is the sign-in link mailed to
   * the address, and the link never appears in the response: whoever submits
   * someone else's address creates an account they cannot open. An address that
   * already has an account is refused — a public request must never attach
   * anything to an existing account.
   */
  async submit(payload: CreateChefApplicationDto, requestId?: string) {
    this.assertValid(payload);
    await this.assertPlaces(payload);
    if (!this.clerk.configured) {
      throw new ServiceUnavailableException(
        'Submitting a candidature requires a real CLERK_SECRET_KEY (not sk_test_placeholder).',
      );
    }

    const email = payload.identity.email.trim().toLowerCase();
    await this.assertEmailFree(email);

    const answers = this.answers(payload, email);
    const fullName = `${answers.firstName} ${answers.lastName}`;
    const clerk = this.clerk.getClient();

    let clerkUserId: string;
    try {
      ({ id: clerkUserId } = await clerk.users.createUser({
        emailAddress: [email],
        firstName: answers.firstName,
        lastName: answers.lastName,
        skipPasswordRequirement: true,
      }));
    } catch (error) {
      throw this.mapClerkError(error);
    }

    // Everything that can still fail happens before anything is left behind: a
    // failure deletes the Clerk user, and the candidate can simply submit again.
    let link: { signInUrl: string; expiresAt: Date };
    let created: { userId: string; application: ChefApplication };
    try {
      link = await this.signInLink(clerkUserId);
      created = await this.prisma.$transaction(async (tx) => {
        // Upsert: Clerk's `user.created` webhook may land first and create the row
        // as a client.
        const user = await tx.user.upsert({
          where: { clerkUserId },
          create: {
            clerkUserId,
            email,
            fullName,
            phone: answers.phone,
            role: UserRole.chef,
          },
          update: { fullName, phone: answers.phone, role: UserRole.chef },
        });
        // `isVerified` and `isActive` keep their `false` defaults until approval.
        const profile = await tx.chefProfile.create({
          data: { userId: user.id, displayName: fullName, city: answers.addressCity },
        });
        const application = await tx.chefApplication.create({
          data: {
            ...answers,
            reference: await this.nextReference(tx),
            chefProfileId: profile.id,
          },
        });
        return { userId: user.id, application };
      });
    } catch (error) {
      const compensated = await this.deleteClerkUser(clerkUserId);
      await this.audit.failed(
        {
          actorType: 'candidate',
          action: 'application.submit',
          subjectType: 'chef_application',
          requestId,
          metadata: { clerkUserId, compensated },
        },
        error,
      );
      throw error;
    }

    const { application } = created;
    await this.audit.record({
      actorType: 'candidate',
      actorUserId: created.userId,
      action: 'application.submitted',
      subjectType: 'chef_application',
      subjectId: application.id,
      requestId,
      metadata: { reference: application.reference, city: application.addressCity },
    });

    const [received] = await Promise.all([
      this.mailer.applicationReceived({
        email,
        firstName: application.firstName,
        reference: application.reference,
        ...link,
      }),
      this.mailer.applicationReceivedAdmin({
        reference: application.reference,
        applicationId: application.id,
        name: fullName,
        city: application.addressCity,
      }),
    ]);
    // That email is the only way into the account, so a lost one must be findable
    // by candidature — the recovery is `POST /admin/chef-users/:id/resend-invitation`.
    if (!received.sent) {
      await this.audit.failed(
        {
          actorType: 'system',
          actorUserId: created.userId,
          action: 'application.sign_in_link_email',
          subjectType: 'chef_application',
          subjectId: application.id,
          requestId,
          metadata: { reference: application.reference },
        },
        new Error('sign-in link email not sent'),
      );
    }

    return {
      ...this.toCandidateView(application),
      // Whether the email left, so the site can say what to do when it did not.
      // Never the link itself: whoever submits must not get into the account.
      invitation: {
        delivered: received.sent,
        sentAt: received.sent ? new Date() : null,
        expiresAt: link.expiresAt,
      },
    };
  }

  /** `GET /me/chef-application` — the caller's candidature and its dossier. */
  async mine(clerkUserId: string) {
    const profile = await this.prisma.chefProfile.findFirst({
      where: { user: { clerkUserId } },
      include: { application: true },
    });
    if (!profile?.application) {
      throw new NotFoundException('No candidature for this account.');
    }

    const dossier = await this.documents.dossier(
      profile.id,
      this.documents.answersOf(profile.application),
      { disabled: isDisabledByAdmin(profile) },
    );
    // The dossier's `documents` replaces the view's all-missing list.
    return {
      ...this.toCandidateView(profile.application),
      // Read back so the candidate can correct them (`PATCH /me/chef-application`).
      answers: toAnswersView(profile.application),
      ...dossier,
    };
  }

  /**
   * `POST /me/chef-application/reapply` — a refused candidate applies again from the
   * account they kept (FLOW-01 §6).
   *
   * Reopens the same candidature with fresh answers instead of adding a second one:
   * one account, one candidature. The earlier decision stays in the audit log, and
   * documents already deposited stay in the dossier with their statuses.
   */
  async reapply(
    clerkUserId: string,
    payload: CreateChefApplicationDto,
    requestId?: string,
  ) {
    this.assertValid(payload);
    await this.assertPlaces(payload);

    const profile = await this.prisma.chefProfile.findFirst({
      where: { user: { clerkUserId } },
      include: { application: true, user: { select: { email: true } } },
    });
    const application = profile?.application;
    if (!profile || !application) {
      throw new NotFoundException('No candidature for this account.');
    }
    if (application.status !== ChefApplicationStatus.rejected) {
      throw new ConflictException({
        code: 'APPLICATION_NOT_REJECTED',
        message: 'Only a refused candidature can be submitted again.',
      });
    }
    if (application.allowReapplyAfter && application.allowReapplyAfter > new Date()) {
      const from = application.allowReapplyAfter.toISOString().slice(0, 10);
      throw new ConflictException({
        code: 'REAPPLY_TOO_EARLY',
        message: `A new candidature is possible from ${from}.`,
        allowReapplyAfter: from,
      });
    }

    // The account's own address: this route cannot redirect anything to another inbox.
    const email = payload.identity.email.trim().toLowerCase();
    if (email !== profile.user.email.toLowerCase()) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'identity.email must be the address of this account.',
      });
    }

    const now = new Date();
    const reopened = await this.prisma.chefApplication.update({
      where: { id: application.id },
      data: {
        ...this.answers(payload, profile.user.email),
        status: ChefApplicationStatus.submitted,
        submittedAt: now,
        lastActivityAt: now,
        decidedAt: null,
        decidedByUserId: null,
        decisionReason: null,
        decisionReasonCode: null,
        allowReapplyAfter: null,
      },
    });

    await this.audit.record({
      actorType: 'candidate',
      actorUserId: profile.userId,
      action: 'application.resubmitted',
      subjectType: 'chef_application',
      subjectId: reopened.id,
      requestId,
      metadata: { reference: reopened.reference, city: reopened.addressCity },
    });

    await this.mailer.applicationReceivedAdmin({
      reference: reopened.reference,
      applicationId: reopened.id,
      name: `${reopened.firstName} ${reopened.lastName}`,
      city: reopened.addressCity,
    });

    // With its dossier: documents deposited before the refusal keep their statuses.
    return this.mine(clerkUserId);
  }

  /**
   * `PATCH /me/chef-application` — the candidate corrects their answers while the
   * candidature awaits a decision.
   *
   * Each section sent replaces the stored one, and the merged candidature passes the
   * same rules as a submission. A changed answer can change what is required, so the
   * dossier comes back recomputed. The account's address and the consent proof are
   * not part of the body.
   *
   * An answer a validated document proves is locked ({@link lockingDocuments}): the
   * admin's decision holds for the answer as it stood. Without this, a registration
   * certificate could be validated and the SIRET swapped before approval copies it.
   */
  async update(
    clerkUserId: string,
    payload: UpdateChefApplicationDto,
    requestId?: string,
  ) {
    const profile = await this.prisma.chefProfile.findFirst({
      where: { user: { clerkUserId } },
      include: { application: true },
    });
    const application = profile?.application;
    if (!profile || !application) {
      throw new NotFoundException('No candidature for this account.');
    }
    if (!UNDECIDED.includes(application.status)) {
      throw new ConflictException(APPLICATION_DECIDED);
    }

    // Section by section rather than a spread: the DTO instance carries every
    // section it declares, `undefined` when not sent.
    const stored = toAnswersView(application);
    const merged: CreateChefApplicationDto = {
      identity: { ...(payload.identity ?? stored.identity), email: application.email },
      address: payload.address ?? stored.address,
      interventionZones: payload.interventionZones ?? stored.interventionZones,
      workAuthorization: payload.workAuthorization ?? stored.workAuthorization,
      company: payload.company ?? stored.company,
      consent: stored.consent,
    };
    this.assertValid(merged);
    // The sections sent only: what is on file was checked when it was written.
    await this.assertPlaces(payload);

    const next = this.answers(merged, application.email);
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (column) => !sameValue(next[column], application[column]),
    );
    if (changed.length === 0) return this.mine(clerkUserId);

    const locking = lockingDocuments(
      changed,
      this.documents.answersOf(application),
      await this.documents.latestPerType(profile.id),
    );
    if (locking.length > 0) {
      const documents = locking.map(toWire);
      throw new ConflictException({
        code: 'ANSWER_LOCKED',
        message:
          `A validated document proves these answers (${documents.join(', ')}). ` +
          'Deposit a new version of it first.',
        documents,
      });
    }

    const renamed = changed.includes('firstName') || changed.includes('lastName');
    const fullName = `${next.firstName} ${next.lastName}`;
    await this.prisma.$transaction(async (tx) => {
      // The status check and the write are one statement: an edit cannot land on a
      // candidature an admin decided in the meantime.
      const { count } = await tx.chefApplication.updateMany({
        where: { id: application.id, status: { in: UNDECIDED } },
        data: { ...next, lastActivityAt: new Date() },
      });
      if (count === 0) throw new ConflictException(APPLICATION_DECIDED);

      // What submission copied from the answers follows them.
      if (renamed || changed.includes('phone')) {
        await tx.user.update({
          where: { id: profile.userId },
          data: { fullName, phone: next.phone },
        });
      }
      if (renamed || changed.includes('addressCity')) {
        await tx.chefProfile.update({
          where: { id: profile.id },
          data: { displayName: fullName, city: next.addressCity },
        });
      }
    });

    await this.audit.record({
      actorType: 'candidate',
      actorUserId: profile.userId,
      action: 'application.updated',
      subjectType: 'chef_application',
      subjectId: application.id,
      requestId,
      // Which answers, never their values: the journal is not a copy of the dossier.
      metadata: { reference: application.reference, changed },
    });

    return this.mine(clerkUserId);
  }

  /**
   * `POST /admin/chef-users/:id/resend-invitation` — a fresh sign-in link, for a
   * batch cooker whose first one expired before they used it. Always to the
   * account's own address.
   */
  async resendSignInLink(userId: string, adminUserId: string, requestId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clerkUserId: true, email: true, fullName: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role !== UserRole.chef) {
      throw new ConflictException({
        code: 'NOT_A_CHEF',
        message: 'Only a batch cooker account can be re-invited.',
      });
    }
    if (!this.clerk.configured) {
      throw new ServiceUnavailableException('Clerk is not configured.');
    }

    const link = await this.signInLink(user.clerkUserId);
    const { sent } = await this.mailer.signInLink({
      email: user.email,
      firstName: user.fullName?.split(' ')[0] ?? '',
      ...link,
    });

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'chef.invitation_resent',
      subjectType: 'user',
      subjectId: userId,
      outcome: sent ? 'ok' : 'failed',
      requestId,
    });

    // `delivered: false` tells the admin the link did not leave (Brevo down, or
    // `BREVO_TPL_SIGN_IN_LINK` unset) instead of claiming it was sent.
    return {
      channel: 'magic-link' as const,
      sentTo: user.email,
      delivered: sent,
      expiresAt: link.expiresAt,
    };
  }

  /**
   * What the candidate may see (FLOW-01 §4): their own candidature, and nothing
   * internal — no admin notes, no review queue position. On refusal, the reason
   * exactly as the admin wrote it and the date a new candidature becomes possible.
   */
  toCandidateView(application: ChefApplication) {
    const refused = application.status === ChefApplicationStatus.rejected;
    return {
      id: application.id,
      reference: application.reference,
      status: toWire(application.status),
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      refusal: refused
        ? {
            reason: application.decisionReason,
            allowReapplyAfter:
              application.allowReapplyAfter?.toISOString().slice(0, 10) ?? null,
          }
        : null,
      // Kebab-case on the wire, as the flow document's 201 response specifies.
      documents: requiredDocuments(this.documents.answersOf(application)).map((doc) => ({
        ...doc,
        type: toWire(doc.type),
        status: 'missing' as const,
      })),
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

    const zonesProblem = interventionZonesProblem(payload.interventionZones);
    if (zonesProblem) fail(zonesProblem);

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
   * The address and the zone towns against the official commune base
   * (geo.api.gouv.fr): `93100` + `Marseille` is refused, naming the communes the
   * postcode does serve. Only the sections given are checked.
   */
  private async assertPlaces(
    sections: Pick<Partial<CreateChefApplicationDto>, 'address' | 'interventionZones'>,
  ): Promise<void> {
    const { address, interventionZones = [] } = sections;
    await this.geo.assertCommune(address?.postcode, address?.city, 'address.city');
    for (const zone of interventionZones) {
      if (zone.cities.length === 0) continue;
      const problem = zoneCitiesProblem(
        zone,
        await this.geo.communesByRegion(zone.regionCode),
      );
      if (problem) {
        throw new UnprocessableEntityException({
          code: 'ZONE_CITY_UNKNOWN',
          message: problem,
        });
      }
    }
  }

  /** The candidature's own columns, as submitted. Shared by submission and reapplication. */
  private answers(payload: CreateChefApplicationDto, email: string) {
    return {
      firstName: payload.identity.firstName.trim(),
      lastName: payload.identity.lastName.trim(),
      email,
      phone: payload.identity.phone,
      addressStreet: payload.address.street,
      addressLine2: payload.address.line2 ?? null,
      addressPostcode: payload.address.postcode,
      addressCity: payload.address.city,
      addressCountry: payload.address.country ?? 'FR',
      interventionZones: payload.interventionZones as unknown as Prisma.InputJsonValue,
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
    };
  }

  /**
   * An address holds at most one account (FLOW-01 §2). Compared case-insensitively:
   * older rows were written with the address as typed.
   */
  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw new ConflictException(EMAIL_ALREADY_USED);
  }

  /** Clerk knows the address even when Postgres does not, for instance mid-webhook. */
  private mapClerkError(error: unknown): unknown {
    // Structural, as in `UsersService`: Clerk's own error types do not resolve here.
    if (!error || typeof error !== 'object' || !('status' in error)) return error;
    const { status, errors = [] } = error as {
      status: number;
      errors?: { code?: string; longMessage?: string }[];
    };
    if (status === 409 || errors.some((e) => e.code === 'form_identifier_exists')) {
      return new ConflictException(EMAIL_ALREADY_USED);
    }
    if (status === 400 || status === 422) {
      return new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: errors[0]?.longMessage ?? 'identity.email was refused.',
      });
    }
    return error;
  }

  /** A single-use link into the account, valid 7 days, on the site's sign-in page. */
  private async signInLink(clerkUserId: string) {
    const { token } = await this.clerk.getClient().signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds: SIGN_IN_LINK_TTL_SECONDS,
    });
    return {
      signInUrl: this.mailer.signInUrl(token),
      expiresAt: new Date(Date.now() + SIGN_IN_LINK_TTL_SECONDS * 1000),
    };
  }

  /**
   * Compensation: never leave a Clerk account with no `users` row behind it.
   * Reports whether it worked, so the audit row never claims a cleanup that failed.
   */
  private async deleteClerkUser(clerkUserId: string): Promise<boolean> {
    try {
      await this.clerk.getClient().users.deleteUser(clerkUserId);
      return true;
    } catch (error) {
      this.logger.error(
        `Orphaned Clerk user ${clerkUserId} after a failed candidature submission`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * `APP-2026-0042`, sequential within the calendar year.
   *
   * ponytail: count + 1, so two submissions in the same instant compute the same
   * reference; the unique index fails the second, which is compensated and can be
   * resubmitted. Switch to a per-year Postgres sequence if submissions ever collide.
   */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getUTCFullYear();
    const countThisYear = await tx.chefApplication.count({
      where: { reference: { startsWith: `APP-${year}-` } },
    });
    return buildApplicationReference(year, countThisYear + 1);
  }
}

/**
 * A candidature's answers in the shape they are submitted in (FLOW-01 §2): what the
 * admin reviews, what the candidate reads back to correct, and the base a
 * correction is merged over.
 */
export function toAnswersView(application: ChefApplication): CreateChefApplicationDto {
  return {
    identity: {
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
    },
    address: {
      street: application.addressStreet,
      line2: application.addressLine2,
      postcode: application.addressPostcode,
      city: application.addressCity,
      country: application.addressCountry,
    },
    interventionZones: application.interventionZones as unknown as InterventionZoneDto[],
    workAuthorization: {
      status: toWire(application.workAuthorizationStatus),
      details: application.workAuthorizationDetails,
    },
    company: {
      legalForm: toWire(application.companyLegalForm),
      siret: application.companySiret,
      sap: {
        path: toWire(application.sapPath),
        declarationNumber: application.sapDeclarationNumber,
      },
    },
    consent: {
      privacyPolicy: application.consentPrivacyPolicy,
      terms: application.consentTerms,
      acceptedAt: application.consentAcceptedAt.toISOString(),
    },
  };
}

/** Equal as JSON, whatever the key order: jsonb hands keys back sorted, not as sent. */
const sameValue = (a: unknown, b: unknown): boolean =>
  isDeepStrictEqual(
    JSON.parse(JSON.stringify(a ?? null)),
    JSON.parse(JSON.stringify(b ?? null)),
  );
