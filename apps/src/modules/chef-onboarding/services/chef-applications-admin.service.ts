import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  ChefApplicationStatus,
  ChefDocumentStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
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

const AWAITING_DECISION: ChefDocumentStatus[] = [
  ChefDocumentStatus.submitted,
  ChefDocumentStatus.reviewing,
];

/** Statuses an admin may still decide on. */
const UNDECIDED: ChefApplicationStatus[] = [
  ChefApplicationStatus.submitted,
  ChefApplicationStatus.changes_requested,
];

const APPLICATION_DECIDED = {
  code: 'APPLICATION_DECIDED',
  message: 'This candidature has already been decided.',
};

@Injectable()
export class ChefApplicationsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ChefDocumentsService,
    private readonly storage: KycStorageService,
    private readonly audit: AuditService,
    private readonly mailer: ChefOnboardingMailer,
    private readonly dossier: ChefDossierCron,
  ) {}

  /**
   * A candidature with its account. One whose account was deleted survives only as
   * the 5-year consent proof (FLOW-01 §8) and is no longer an admin's to review.
   */
  private async load(id: string) {
    const application = await this.prisma.chefApplication.findUnique({ where: { id } });
    if (!application?.chefProfileId)
      throw new NotFoundException('Candidature not found.');
    return { ...application, chefProfileId: application.chefProfileId };
  }

  /** FLOW-01 §5.1 — the review queue, oldest wait first. */
  async list(query: ListChefApplicationsQueryDto) {
    const bounds = resolvePageBounds(query);
    const where: Prisma.ChefApplicationWhereInput = { chefProfileId: { not: null } };

    if (query.status) where.status = fromWire(query.status) as ChefApplicationStatus;
    if (query.hasPendingDocuments) {
      where.chefProfile = { documents: { some: { status: { in: AWAITING_DECISION } } } };
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
        orderBy: [
          // Open suspension episodes first, oldest first. `asc` puts NULLs last
          // in Postgres, so dossiers with no episode fall to the back — which is
          // the wanted order using only the plain, unambiguous form rather than
          // an explicit `{ sort, nulls }` object on a relation field.
          { chefProfile: { autoSuspendedAt: 'asc' } },
          { submittedAt: 'asc' },
        ],
        skip: bounds.skip,
        take: bounds.take,
        include: {
          // `autoSuspendedAt` still set while the chef is live means they were
          // reactivated on the strength of an unreviewed replacement.
          chefProfile: {
            select: {
              isActive: true,
              autoSuspendedAt: true,
              documents: { select: { type: true, status: true, version: true } },
            },
          },
        },
      }),
      this.prisma.chefApplication.count({ where }),
    ]);

    const now = Date.now();
    return {
      data: rows.map((row) => {
        const latest = new Map<string, ChefDocumentStatus>();
        const documents = row.chefProfile?.documents ?? [];
        for (const doc of [...documents].sort((a, b) => b.version - a.version)) {
          if (!latest.has(doc.type)) latest.set(doc.type, doc.status);
        }
        // Live right now on a document nobody has looked at yet. These jump the
        // queue: the storefront is already back up, so the review is the only
        // thing standing between a bad document and a booked client.
        const reactivatedPendingReview = Boolean(
          row.chefProfile?.autoSuspendedAt && row.chefProfile.isActive,
        );

        return {
          id: row.id,
          reference: row.reference,
          name: `${row.firstName} ${row.lastName}`,
          city: row.addressCity,
          status: toWire(row.status),
          reactivatedPendingReview,
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
    const application = await this.load(id);

    const dossier = await this.documents.dossier(
      application.chefProfileId,
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
      chefProfileId: application.chefProfileId,
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
    const { chefProfileId } = await this.load(applicationId);
    const document = await this.prisma.chefDocument.findFirst({
      where: { chefProfileId, type },
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

    const application = await this.load(applicationId);

    const current = await this.prisma.chefDocument.findFirst({
      where: { chefProfileId: application.chefProfileId, type },
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

    // Both outcomes matter: accepting closes the suspension episode, refusing
    // takes a chef who was reactivated on trust back offline.
    await this.dossier.refreshActivation(application.chefProfileId);

    if (body.decision === 'rejected') {
      await this.mailer.documentRejected({
        email: application.email,
        firstName: application.firstName,
        documentLabel: DOCUMENT_LABEL[type],
        reason: updated.reason!,
      });
    }

    const dossier = await this.documents.dossier(
      application.chefProfileId,
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

  /** FLOW-01 §5.4 — ask for more without refusing. */
  async requestChanges(
    applicationId: string,
    body: RequestChangesDto,
    adminUserId: string,
    requestId?: string,
  ) {
    const application = await this.load(applicationId);
    const types = body.documentTypes.map((t) => this.documents.parseType(t));
    await this.transition(applicationId, {
      status: ChefApplicationStatus.changes_requested,
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
    });

    return {
      status: toWire(ChefApplicationStatus.changes_requested),
      documentTypes: types.map(toWire),
    };
  }

  /**
   * Moves an undecided candidature on, atomically: the status check and the write
   * are one statement, so an approval and a refusal racing each other cannot both
   * land. Runs inside the caller's transaction when given one.
   */
  private async transition(
    applicationId: string,
    data: Prisma.ChefApplicationUncheckedUpdateManyInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const { count } = await tx.chefApplication.updateMany({
      where: { id: applicationId, status: { in: UNDECIDED } },
      data,
    });
    if (count === 0) throw new ConflictException(APPLICATION_DECIDED);
  }

  /**
   * FLOW-01 §6 — approval: the candidate's account becomes a verified chef.
   *
   * The account and its chef profile already exist from submission, so this is a
   * state change in one transaction — no Clerk call, nothing to compensate. The
   * answers are copied onto the profile here rather than at submission, so a
   * reapplication can change them without touching a live profile.
   *
   * Idempotent by state: approving an approved candidature returns the same result.
   */
  async approve(
    applicationId: string,
    body: ApproveApplicationDto,
    adminUserId: string,
    requestId?: string,
  ) {
    const application = await this.load(applicationId);

    if (application.status === ChefApplicationStatus.approved) {
      return this.approvedResult(applicationId);
    }
    if (application.status === ChefApplicationStatus.rejected) {
      throw new ConflictException({
        code: 'APPLICATION_DECIDED',
        message: 'This candidature was rejected and cannot be approved.',
      });
    }

    // The guardrail: no verified chef without a validated blocking document set.
    const dossier = await this.documents.dossier(
      application.chefProfileId,
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

    await this.prisma.$transaction(async (tx) => {
      await this.transition(
        applicationId,
        {
          status: ChefApplicationStatus.approved,
          decidedAt: new Date(),
          decidedByUserId: adminUserId,
        },
        tx,
      );
      await tx.chefProfile.update({
        where: { id: application.chefProfileId },
        data: {
          isVerified: true,
          isActive: body.isActive ?? false,
          // From the approved answers: a reapplication may have changed them since
          // the profile was created at the first submission.
          displayName: `${application.firstName} ${application.lastName}`,
          city: application.addressCity,
          interventionZones: application.interventionZones as Prisma.InputJsonValue,
          sapPath: application.sapPath,
          sapDeclarationNumber: application.sapDeclarationNumber,
        },
      });
    });

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'application.approved',
      subjectType: 'chef_application',
      subjectId: applicationId,
      requestId,
      metadata: {
        chefProfileId: application.chefProfileId,
        isActive: body.isActive ?? false,
        note: body.note ?? null,
      },
    });

    await this.mailer.applicationApproved({
      email: application.email,
      firstName: application.firstName,
    });

    return this.approvedResult(applicationId);
  }

  /** Shape returned by a first approval and by every idempotent repeat of it. */
  private async approvedResult(applicationId: string) {
    const application = await this.prisma.chefApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        chefProfile: {
          select: {
            id: true,
            displayName: true,
            isVerified: true,
            isActive: true,
            user: { select: { id: true, clerkUserId: true, email: true, role: true } },
          },
        },
      },
    });
    const { user, ...chefProfile } = application.chefProfile!;

    return {
      application: {
        id: application.id,
        status: toWire(application.status),
        approvedAt: application.decidedAt,
      },
      user,
      chefProfile,
    };
  }

  /**
   * FLOW-01 §6 — refusal. The account stays, unverified and browse-only, showing the
   * reason and the reapply date (`GET /me/chef-application`).
   */
  async reject(
    applicationId: string,
    body: RejectApplicationDto,
    adminUserId: string,
    requestId?: string,
  ) {
    const application = await this.load(applicationId);

    await this.transition(applicationId, {
      status: ChefApplicationStatus.rejected,
      decidedAt: new Date(),
      decidedByUserId: adminUserId,
      decisionReason: body.reason.trim(),
      decisionReasonCode: body.reasonCode ?? 'other',
      allowReapplyAfter: body.allowReapplyAfter ? new Date(body.allowReapplyAfter) : null,
    });

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'application.rejected',
      subjectType: 'chef_application',
      subjectId: applicationId,
      requestId,
      // The full decision: a reapplication clears it from the candidature row, so
      // this is where it stays on record.
      metadata: {
        reasonCode: body.reasonCode ?? 'other',
        reason: body.reason.trim(),
        allowReapplyAfter: body.allowReapplyAfter ?? null,
      },
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
