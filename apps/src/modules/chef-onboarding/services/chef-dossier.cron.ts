import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  ChefApplicationStatus,
  ChefDocumentStatus,
} from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DOCUMENT_FAMILY,
  DOCUMENT_LABEL,
  EXPIRY_NOTICE_DAYS,
  expiryNoticeThreshold,
} from '../domain/chef-onboarding.rules';
import { ChefDocumentsService } from './chef-documents.service';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';
import { KycStorageService } from './kyc-storage.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

/**
 * The daily dossier job (FLOW-01 §7 and §8).
 *
 * ponytail: in-process cron, no queue. Two API replicas would both fire it, so
 * every step below is idempotent — a second run the same day sends nothing extra
 * and changes nothing twice. Move to a queue or a database advisory lock when a
 * second replica is actually added.
 */
@Injectable()
export class ChefDossierCron {
  private readonly logger = new Logger(ChefDossierCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ChefDocumentsService,
    private readonly storage: KycStorageService,
    private readonly mailer: ChefOnboardingMailer,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'chef-dossier-daily' })
  async runDaily(): Promise<void> {
    const startedAt = Date.now();
    try {
      const warned = await this.warnExpiring();
      const expired = await this.expireLapsed();
      const purged = await this.purgeRetention();
      this.logger.log(
        `Dossier job done in ${Date.now() - startedAt}ms ` +
          `(warned=${warned} expired=${expired} purgedApplications=${purged})`,
      );
    } catch (error) {
      this.logger.error(
        'Dossier job failed',
        error instanceof Error ? error.stack : String(error),
      );
      await this.audit.failed(
        { actorType: 'system', action: 'dossier.daily_job', subjectType: 'job' },
        error,
      );
    }
  }

  /**
   * J-60, J-30, J-7 warnings. `expiryNoticeDays` records the last threshold sent,
   * so re-running the job never mails the same warning twice.
   */
  private async warnExpiring(): Promise<number> {
    const horizon = new Date(Date.now() + EXPIRY_NOTICE_DAYS[0] * DAY_MS);
    const candidates = await this.prisma.chefDocument.findMany({
      where: {
        // A candidate's piece expiring mid-review is the review's business, not a
        // renewal reminder: the dossier already reads it once it lapses.
        chefProfile: { isVerified: true },
        expiresOn: { not: null, lte: horizon, gt: new Date() },
        status: { in: [ChefDocumentStatus.valid, ChefDocumentStatus.expiring] },
      },
      include: { chefProfile: { include: { user: true } } },
    });

    let sent = 0;
    for (const doc of candidates) {
      const daysLeft = Math.ceil((doc.expiresOn!.getTime() - Date.now()) / DAY_MS);
      const threshold = expiryNoticeThreshold(daysLeft);
      if (!threshold) continue;
      if (doc.expiryNoticeDays !== null && doc.expiryNoticeDays <= threshold) continue;

      await this.prisma.chefDocument.update({
        where: { id: doc.id },
        data: { status: ChefDocumentStatus.expiring, expiryNoticeDays: threshold },
      });

      const user = doc.chefProfile.user;
      await this.mailer.documentExpiring({
        email: user.email,
        firstName: user.fullName?.split(' ')[0] ?? '',
        documentLabel: DOCUMENT_LABEL[doc.type],
        expiresOn: doc.expiresOn!.toISOString().slice(0, 10),
        daysLeft: threshold,
      });

      await this.audit.record({
        actorType: 'system',
        action: 'document.expiring',
        subjectType: 'chef_document',
        subjectId: doc.id,
        metadata: { type: doc.type, daysLeft: threshold },
      });
      sent += 1;
    }
    return sent;
  }

  /**
   * Past `expiresOn`: the document expires, and if it was blocking the storefront
   * comes down.
   *
   * `autoSuspendedAt` marks this as the platform's doing, so a chef an admin
   * deliberately deactivated is never silently reactivated later.
   */
  private async expireLapsed(): Promise<number> {
    const lapsed = await this.prisma.chefDocument.findMany({
      where: {
        expiresOn: { not: null, lte: new Date() },
        status: { in: [ChefDocumentStatus.valid, ChefDocumentStatus.expiring] },
      },
      include: { chefProfile: { include: { user: true } } },
    });

    for (const doc of lapsed) {
      await this.prisma.chefDocument.update({
        where: { id: doc.id },
        data: { status: ChefDocumentStatus.expired },
      });

      await this.audit.record({
        actorType: 'system',
        action: 'document.expired',
        subjectType: 'chef_document',
        subjectId: doc.id,
        metadata: { type: doc.type, family: DOCUMENT_FAMILY[doc.type] },
      });

      const profile = doc.chefProfile;
      // An inactive profile has no storefront to take down — a candidate awaiting
      // approval, or a chef already offline.
      if (DOCUMENT_FAMILY[doc.type] !== 'blocking' || !profile.isActive) continue;

      await this.prisma.chefProfile.update({
        where: { id: profile.id },
        data: { isActive: false, autoSuspendedAt: new Date() },
      });

      await this.audit.record({
        actorType: 'system',
        action: 'chef.suspended',
        subjectType: 'chef_profile',
        subjectId: profile.id,
        metadata: { reason: 'blocking_document_expired', type: doc.type },
      });

      await this.mailer.chefSuspended({
        email: profile.user.email,
        firstName: profile.user.fullName?.split(' ')[0] ?? '',
        documentLabel: DOCUMENT_LABEL[doc.type],
      });
    }
    return lapsed.length;
  }

  /**
   * FLOW-01 §8 — purges the **files and document rows** of candidatures that were
   * refused 3 months ago or abandoned 6 months ago.
   *
   * The account stays (a refused candidate keeps it, browse-only) and so does the
   * candidature row: §8 also requires the consent proof to be retained for 5 years.
   * A verified chef's documents are never touched — that clock runs from the end of
   * the contract, which this system does not model.
   */
  private async purgeRetention(): Promise<number> {
    const now = Date.now();
    const stale = await this.prisma.chefApplication.findMany({
      where: {
        chefProfile: { isVerified: false, documents: { some: {} } },
        OR: [
          {
            status: ChefApplicationStatus.rejected,
            decidedAt: { lte: new Date(now - 3 * MONTH_MS) },
          },
          {
            status: {
              in: [
                ChefApplicationStatus.submitted,
                ChefApplicationStatus.changes_requested,
              ],
            },
            lastActivityAt: { lte: new Date(now - 6 * MONTH_MS) },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        chefProfile: {
          select: { documents: { select: { id: true, storagePath: true } } },
        },
      },
    });

    for (const application of stale) {
      const documents = application.chefProfile?.documents ?? [];
      if (documents.length === 0) continue;

      await this.storage.removeObjects(documents.map((doc) => doc.storagePath));
      await this.prisma.chefDocument.deleteMany({
        where: { id: { in: documents.map((doc) => doc.id) } },
      });

      await this.audit.record({
        actorType: 'system',
        action: 'application.documents_purged',
        subjectType: 'chef_application',
        subjectId: application.id,
        metadata: {
          status: application.status,
          purgedDocuments: documents.length,
          consentRowRetained: true,
        },
      });
    }
    return stale.length;
  }

  /**
   * Re-evaluates a chef's storefront after anything touches their dossier.
   *
   * `autoSuspendedAt` marks an **open automatic-suspension episode**, not merely
   * "currently offline". It stays set while the replacement is unreviewed, which
   * is what lets the admin queue show the chef as reactivated-but-unverified, and
   * is cleared only once an admin validates the replacement. An admin
   * deactivation leaves it null, so a chef taken down by a human is never brought
   * back by this method.
   *
   * | Dossier derives to | Storefront | Episode |
   * |---|---|---|
   * | `validated` (admin accepted the replacement) | online | closed |
   * | `reviewing` (replacement deposited, unreviewed) | online, on trust | stays open |
   * | anything else (missing or refused blocking piece) | offline | stays open |
   *
   * The middle row is FLOW-01 §7's "réversible immédiatement": the chef is live
   * again the moment they deposit, rather than waiting on a review queue. The
   * third row is what re-suspends them if that replacement is then refused.
   */
  async refreshActivation(chefProfileId: string): Promise<boolean> {
    const profile = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      include: { application: true },
    });
    // No open episode: never auto-suspended, or an admin turned them off. And never
    // for an unverified profile — nothing but approval may bring a candidate online.
    if (
      !profile?.application ||
      !profile.isVerified ||
      profile.autoSuspendedAt === null
    ) {
      return false;
    }

    const latest = await this.documents.latestPerType(chefProfileId);
    const status = this.documents.deriveStatus(
      latest,
      this.documents.answersOf(profile.application),
    );

    if (status === 'validated') {
      await this.prisma.chefProfile.update({
        where: { id: chefProfileId },
        data: { isActive: true, autoSuspendedAt: null },
      });
      await this.audit.record({
        actorType: 'system',
        action: 'chef.reactivated',
        subjectType: 'chef_profile',
        subjectId: chefProfileId,
        metadata: { reviewed: true },
      });
      return true;
    }

    if (status === 'reviewing') {
      if (profile.isActive) return true;
      await this.prisma.chefProfile.update({
        where: { id: chefProfileId },
        data: { isActive: true },
      });
      await this.audit.record({
        actorType: 'system',
        action: 'chef.reactivated_pending_review',
        subjectType: 'chef_profile',
        subjectId: chefProfileId,
        metadata: { reviewed: false },
      });
      return true;
    }

    // A blocking piece is missing or was refused — back offline, episode open.
    if (profile.isActive) {
      await this.prisma.chefProfile.update({
        where: { id: chefProfileId },
        data: { isActive: false },
      });
      await this.audit.record({
        actorType: 'system',
        action: 'chef.suspended',
        subjectType: 'chef_profile',
        subjectId: chefProfileId,
        metadata: { reason: 'replacement_not_acceptable', dossierStatus: status },
      });
    }
    return false;
  }
}
