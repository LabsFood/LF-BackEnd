import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ChefApplicationStatus,
  ChefDocumentStatus,
  Prisma,
  UserRole,
} from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { ClerkService } from '../../../integrations/clerk.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginationMeta,
  resolvePageBounds,
} from '../../../common/dto/pagination.dto';
import { DOCUMENT_LABEL, fromWire, toWire } from '../domain/chef-onboarding.rules';
import {
  ApproveApplicationDto,
  ListChefApplicationsQueryDto,
  RejectApplicationDto,
  RequestChangesDto,
} from '../dto/admin-chef-application.dto';
import { DecideDocumentDto } from '../dto/chef-document.dto';
import { ChefDocumentsService } from './chef-documents.service';
import { ChefDossierCron } from './chef-dossier.cron';
import { KycStorageService } from './kyc-storage.service';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';
import { mintApplicationToken } from './application-token';

const AWAITING_DECISION: ChefDocumentStatus[] = [
  ChefDocumentStatus.submitted,
  ChefDocumentStatus.reviewing,
];

@Injectable()
export class ChefApplicationsAdminService {
  private readonly logger = new Logger(ChefApplicationsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ChefDocumentsService,
    private readonly storage: KycStorageService,
    private readonly audit: AuditService,
    private readonly mailer: ChefOnboardingMailer,
    private readonly clerk: ClerkService,
    private readonly config: ConfigService,
    private readonly dossier: ChefDossierCron,
  ) {}

  /** FLOW-01 §5.1 — the review queue, oldest wait first. */
  async list(query: ListChefApplicationsQueryDto) {
    const bounds = resolvePageBounds(query);
    const where: Prisma.ChefApplicationWhereInput = {};

    if (query.status) where.status = fromWire(query.status) as ChefApplicationStatus;
    if (query.hasPendingDocuments) {
      where.documents = { some: { status: { in: AWAITING_DECISION } } };
    }
    if (query.q) {
      const q = query.q.trim();
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { addressCity: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.chefApplication.findMany({
        where,
        orderBy: { submittedAt: 'asc' },
        skip: bounds.skip,
        take: bounds.take,
        include: { documents: { select: { type: true, status: true, version: true } } },
      }),
      this.prisma.chefApplication.count({ where }),
    ]);

    const now = Date.now();
    return {
      data: rows.map((row) => {
        const latest = new Map<string, ChefDocumentStatus>();
        for (const doc of [...row.documents].sort((a, b) => b.version - a.version)) {
          if (!latest.has(doc.type)) latest.set(doc.type, doc.status);
        }
        return {
          id: row.id,
          reference: row.reference,
          name: `${row.firstName} ${row.lastName}`,
          city: row.addressCity,
          status: toWire(row.status),
          pendingDocuments: [...latest.values()].filter((s) =>
            AWAITING_DECISION.includes(s),
          ).length,
          submittedAt: row.submittedAt,
          // Drives the « réponse sous 48 h ouvrées » promise: this is what lets the
          // queue be sorted by urgency rather than by arrival.
          waitingSinceHours: Math.floor((now - row.submittedAt.getTime()) / 3_600_000),
        };
      }),
      meta: buildPaginationMeta(bounds, total),
    };
  }

  /** Full dossier for one candidature, including everything the candidate cannot see. */
  async detail(id: string) {
    const application = await this.prisma.chefApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Candidature not found.');

    const dossier = await this.documents.dossier(
      { kind: 'application', applicationId: id },
      this.documents.answersOf(application),
    );

    return {
      id: application.id,
      reference: application.reference,
      status: toWire(application.status),
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
      interventionZones: application.interventionZones,
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
        acceptedAt: application.consentAcceptedAt,
      },
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      ...dossier,
    };
  }

  /** FLOW-01 §3.4 — a signed read link, and a trace of who opened what. */
  async documentDownloadUrl(
    applicationId: string,
    wireType: string,
    adminUserId: string,
    requestId?: string,
  ) {
    const type = this.documents.parseType(wireType);
    const document = await this.prisma.chefDocument.findFirst({
      where: { applicationId, type },
      orderBy: { version: 'desc' },
    });
    if (!document) throw new NotFoundException('No document deposited for this type.');

    const link = await this.storage.createDownloadUrl(document.storagePath);

    // Written before the URL reaches the admin: an identity document is consulted,
    // and every consultation is on the record.
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'document.read',
      subjectType: 'chef_document',
      subjectId: document.id,
      requestId,
      metadata: { applicationId, type: toWire(type), version: document.version },
    });

    return { ...link, type: toWire(type), version: document.version };
  }

  /** FLOW-01 §5.2 — accept or refuse one document, and recompute the dossier. */
  async decideDocument(
    applicationId: string,
    wireType: string,
    body: DecideDocumentDto,
    adminUserId: string,
    requestId?: string,
  ) {
    const type = this.documents.parseType(wireType);

    if (body.decision === 'rejected' && !body.reason?.trim()) {
      throw new UnprocessableEntityException({
        code: 'REASON_REQUIRED',
        message: 'A refusal reason of 15 to 500 characters is required.',
      });
    }

    const application = await this.prisma.chefApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Candidature not found.');

    const current = await this.prisma.chefDocument.findFirst({
      where: { applicationId, type },
      orderBy: { version: 'desc' },
    });
    if (!current) throw new NotFoundException('No document deposited for this type.');

    const updated = await this.prisma.chefDocument.update({
      where: { id: current.id },
      data: {
        status:
          body.decision === 'valid'
            ? ChefDocumentStatus.valid
            : ChefDocumentStatus.rejected,
        reason: body.decision === 'rejected' ? body.reason!.trim() : null,
        reasonCode: body.decision === 'rejected' ? (body.reasonCode ?? 'other') : null,
        decidedAt: new Date(),
        decidedByUserId: adminUserId,
      },
    });

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'document.decided',
      subjectType: 'chef_document',
      subjectId: updated.id,
      requestId,
      metadata: {
        applicationId,
        type: toWire(type),
        decision: body.decision,
        reasonCode: updated.reasonCode,
      },
    });

    if (body.decision === 'valid' && updated.chefProfileId) {
      await this.dossier.refreshActivation(updated.chefProfileId);
    }

    if (body.decision === 'rejected') {
      // The candidate needs a live link to come back and correct it.
      const token = await this.refreshToken(applicationId);
      await this.mailer.documentRejected({
        email: application.email,
        firstName: application.firstName,
        documentLabel: DOCUMENT_LABEL[type],
        reason: updated.reason!,
        applicationId,
        token,
      });
    }

    const dossier = await this.documents.dossier(
      { kind: 'application', applicationId },
      this.documents.answersOf(application),
    );

    const decidedBy = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, fullName: true },
    });

    return {
      document: {
        ...this.documents.toView(updated),
        decidedBy: decidedBy && { id: decidedBy.id, name: decidedBy.fullName },
      },
      dossierStatus: dossier.dossierStatus,
      canApprove: dossier.canApprove,
    };
  }

  /** FLOW-01 §5.4 — ask for more without refusing, and extend the link. */
  async requestChanges(
    applicationId: string,
    body: RequestChangesDto,
    adminUserId: string,
    requestId?: string,
  ) {
    const application = await this.prisma.chefApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Candidature not found.');
    this.assertUndecided(application.status);

    const types = body.documentTypes.map((t) => this.documents.parseType(t));
    const token = await this.refreshToken(applicationId);

    await this.prisma.chefApplication.update({
      where: { id: applicationId },
      data: { status: ChefApplicationStatus.changes_requested },
    });

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'application.changes_requested',
      subjectType: 'chef_application',
      subjectId: applicationId,
      requestId,
      metadata: { documentTypes: types.map(toWire) },
    });

    await this.mailer.changesRequested({
      email: application.email,
      firstName: application.firstName,
      message: body.message,
      documentLabels: types.map((t) => DOCUMENT_LABEL[t]),
      applicationId,
      token,
    });

    return {
      status: toWire(ChefApplicationStatus.changes_requested),
      documentTypes: types.map(toWire),
    };
  }

  /** A fresh 30-day token whenever the candidate is asked to come back. */
  private async refreshToken(applicationId: string): Promise<string> {
    const { token, tokenHash, expiresAt } = mintApplicationToken();
    await this.prisma.chefApplication.update({
      where: { id: applicationId },
      data: { tokenHash, tokenExpiresAt: expiresAt },
    });
    return token;
  }

  private assertUndecided(status: ChefApplicationStatus): void {
    if (
      status === ChefApplicationStatus.approved ||
      status === ChefApplicationStatus.rejected
    ) {
      throw new ConflictException({
        code: 'APPLICATION_DECIDED',
        message: 'This candidature has already been decided.',
      });
    }
  }

  /** FLOW-01 §6 — the first-login link lasts 7 days and is single use. */
  private static readonly INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

  /**
   * FLOW-01 §6 — approval, and the only thing that ever creates a chef account.
   *
   * Idempotent by state rather than by an idempotency table: a second call on an
   * already-approved candidature returns the first result instead of creating a
   * second account, which is what an `Idempotency-Key` would have bought.
   *
   * Ordering note: the flow document suggests creating the Clerk user last. The
   * `users.clerk_user_id` column is NOT NULL, so the Postgres row cannot exist
   * before it. The stated goal — never leave a Clerk account without a `users`
   * row — is met instead by creating Clerk first and deleting it if the Postgres
   * transaction then fails.
   */
  async approve(
    applicationId: string,
    body: ApproveApplicationDto,
    adminUserId: string,
    requestId?: string,
  ) {
    const application = await this.prisma.chefApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Candidature not found.');

    if (application.status === ChefApplicationStatus.approved) {
      return this.approvedResult(applicationId);
    }
    if (application.status === ChefApplicationStatus.rejected) {
      throw new ConflictException({
        code: 'APPLICATION_DECIDED',
        message: 'This candidature was rejected and cannot be approved.',
      });
    }

    // The guardrail: no active chef without a validated blocking document set.
    const dossier = await this.documents.dossier(
      { kind: 'application', applicationId },
      this.documents.answersOf(application),
    );
    if (!dossier.canApprove) {
      const blocking = dossier.documents
        .filter((d) => d.required && d.status !== 'valid' && d.status !== 'expiring')
        .map((d) => d.type);
      await this.audit.failed(
        {
          actorType: 'admin',
          actorUserId: adminUserId,
          action: 'application.approve',
          subjectType: 'chef_application',
          subjectId: applicationId,
          requestId,
          metadata: { dossierStatus: dossier.dossierStatus, blocking },
        },
        new Error('blocking documents not validated'),
      );
      throw new ConflictException({
        code: 'DOCUMENT_REQUIRED',
        message: `These documents must be validated first: ${blocking.join(', ')}.`,
        documents: blocking,
      });
    }

    if (!this.clerk.configured) {
      throw new ServiceUnavailableException(
        'Approving a candidature requires a real CLERK_SECRET_KEY (not sk_test_placeholder).',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: application.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_USED',
        message: 'A user already exists for this email address.',
      });
    }

    const clerk = this.clerk.getClient();
    const clerkUser = await clerk.users.createUser({
      emailAddress: [application.email],
      firstName: application.firstName,
      lastName: application.lastName,
      skipPasswordRequirement: true,
    });

    let created: { userId: string; chefProfileId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clerkUserId: clerkUser.id,
            email: application.email,
            fullName: `${application.firstName} ${application.lastName}`,
            phone: application.phone,
            role: UserRole.chef,
          },
        });

        const profile = await tx.chefProfile.create({
          data: {
            userId: user.id,
            displayName: `${application.firstName} ${application.lastName}`,
            city: application.addressCity,
            isVerified: true,
            isActive: body.isActive ?? false,
            interventionZones: application.interventionZones as Prisma.InputJsonValue,
            sapPath: application.sapPath,
            sapDeclarationNumber: application.sapDeclarationNumber,
          },
        });

        // Not a copy: the same rows gain a second owner, so versions, refusal
        // reasons and timestamps carry over without a chance to diverge.
        await tx.chefDocument.updateMany({
          where: { applicationId },
          data: { chefProfileId: profile.id },
        });

        await tx.chefApplication.update({
          where: { id: applicationId },
          data: {
            status: ChefApplicationStatus.approved,
            decidedAt: new Date(),
            decidedByUserId: adminUserId,
            approvedUserId: user.id,
            chefProfileId: profile.id,
            // Revoking the candidate token is a column write, not a blocklist.
            tokenHash: null,
            tokenExpiresAt: null,
          },
        });

        return { userId: user.id, chefProfileId: profile.id };
      });
    } catch (error) {
      // Compensation: never leave a Clerk account with no `users` row behind it.
      try {
        await clerk.users.deleteUser(clerkUser.id);
      } catch (cleanupError) {
        this.logger.error(
          `Orphaned Clerk user ${clerkUser.id} after a failed approval of ${applicationId}`,
          cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
        );
      }
      await this.audit.failed(
        {
          actorType: 'admin',
          actorUserId: adminUserId,
          action: 'application.approve',
          subjectType: 'chef_application',
          subjectId: applicationId,
          requestId,
          metadata: { clerkUserId: clerkUser.id, compensated: true },
        },
        error,
      );
      throw error;
    }

    const invitation = await this.sendInvitation(
      clerkUser.id,
      application.email,
      application.firstName,
    );

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'application.approved',
      subjectType: 'chef_application',
      subjectId: applicationId,
      requestId,
      metadata: {
        userId: created.userId,
        chefProfileId: created.chefProfileId,
        isActive: body.isActive ?? false,
        note: body.note ?? null,
      },
    });

    return this.approvedResult(applicationId, invitation);
  }

  /** Mints and mails the single-use first-login link. */
  private async sendInvitation(clerkUserId: string, email: string, firstName: string) {
    const expiresAt = new Date(
      Date.now() + ChefApplicationsAdminService.INVITATION_TTL_SECONDS * 1000,
    );
    const signIn = await this.clerk.getClient().signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds: ChefApplicationsAdminService.INVITATION_TTL_SECONDS,
    });

    const siteUrl = this.config
      .get<string>('chefOnboarding.publicSiteUrl', 'https://labsfood.fr')
      .replace(/\/$/, '');
    const signInUrl =
      (signIn as { url?: string }).url ?? `${siteUrl}/connexion?ticket=${signIn.token}`;

    await this.mailer.welcomeMagicLink({ email, firstName, signInUrl, expiresAt });
    return { channel: 'magic-link' as const, sentTo: email, expiresAt };
  }

  /** `POST /admin/chef-users/:id/resend-invitation` (FLOW-01 §6). */
  async resendInvitation(userId: string, adminUserId: string, requestId?: string) {
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

    const invitation = await this.sendInvitation(
      user.clerkUserId,
      user.email,
      user.fullName?.split(' ')[0] ?? '',
    );

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'chef.invitation_resent',
      subjectType: 'user',
      subjectId: userId,
      requestId,
    });

    return invitation;
  }

  /** Shape returned by a first approval and by every idempotent repeat of it. */
  private async approvedResult(
    applicationId: string,
    invitation?: { channel: 'magic-link'; sentTo: string; expiresAt: Date },
  ) {
    const application = await this.prisma.chefApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        approvedUser: {
          select: { id: true, clerkUserId: true, email: true, role: true },
        },
        chefProfile: {
          select: { id: true, displayName: true, isVerified: true, isActive: true },
        },
      },
    });

    return {
      application: {
        id: application.id,
        status: toWire(application.status),
        approvedAt: application.decidedAt,
      },
      user: application.approvedUser,
      chefProfile: application.chefProfile,
      invitation: invitation ?? null,
    };
  }

  /** FLOW-01 §6 — refusal creates no account. */
  async reject(
    applicationId: string,
    body: RejectApplicationDto,
    adminUserId: string,
    requestId?: string,
  ) {
    const application = await this.prisma.chefApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Candidature not found.');
    this.assertUndecided(application.status);

    await this.prisma.chefApplication.update({
      where: { id: applicationId },
      data: {
        status: ChefApplicationStatus.rejected,
        decidedAt: new Date(),
        decidedByUserId: adminUserId,
        decisionReason: body.reason.trim(),
        decisionReasonCode: body.reasonCode ?? 'other',
        allowReapplyAfter: body.allowReapplyAfter
          ? new Date(body.allowReapplyAfter)
          : null,
        tokenHash: null,
        tokenExpiresAt: null,
      },
    });

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'application.rejected',
      subjectType: 'chef_application',
      subjectId: applicationId,
      requestId,
      metadata: { reasonCode: body.reasonCode ?? 'other' },
    });

    await this.mailer.applicationRejected({
      email: application.email,
      firstName: application.firstName,
      reason: body.reason.trim(),
      allowReapplyAfter: body.allowReapplyAfter ?? null,
    });

    return {
      id: applicationId,
      status: toWire(ChefApplicationStatus.rejected),
      allowReapplyAfter: body.allowReapplyAfter ?? null,
    };
  }
}
