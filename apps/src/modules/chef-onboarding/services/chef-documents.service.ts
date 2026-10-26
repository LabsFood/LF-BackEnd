import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  ChefApplication,
  ChefDocument,
  ChefDocumentStatus,
  ChefDocumentType,
} from '../../../generated/prisma/client';
import { AuditActorType, AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  deriveDossierStatus,
  DOCUMENT_FAMILY,
  DOCUMENT_LABEL,
  DossierStatus,
  EXPIRING_DOCUMENT_TYPES,
  fromWire,
  requiredDocuments,
  SYSTEM_DOCUMENT_TYPES,
  toWire,
} from '../domain/chef-onboarding.rules';
import { ConfirmUploadDto, CreateUploadUrlDto } from '../dto/chef-document.dto';
import { KycStorageService } from './kyc-storage.service';

@Injectable()
export class ChefDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: KycStorageService,
    private readonly audit: AuditService,
  ) {}

  /** Rejects a type that is not in the closed reference list. */
  parseType(wireType: string): ChefDocumentType {
    const parsed = fromWire(wireType) as ChefDocumentType;
    if (!(parsed in DOCUMENT_LABEL)) {
      throw new NotFoundException(`Unknown document type "${wireType}".`);
    }
    return parsed;
  }

  /**
   * A type a person handles — the chef deposits it, an admin decides it: the reference
   * list minus what the API writes itself. A mandate Stripe confirmed is neither
   * uploaded nor reviewed; it is revoked at Stripe, not refused here.
   */
  parseManualType(wireType: string): ChefDocumentType {
    const type = this.parseType(wireType);
    if (SYSTEM_DOCUMENT_TYPES.has(type)) {
      throw new ForbiddenException({
        code: 'SYSTEM_DOCUMENT',
        message: `"${wireType}" is produced by Lab’s Food from a Stripe signature: it cannot be uploaded or decided.`,
      });
    }
    return type;
  }

  private prefix(chefProfileId: string): string {
    return `chefs/${chefProfileId}`;
  }

  /**
   * The current state of each document type: the highest version wins, older
   * versions are history and must not influence the dossier.
   */
  async latestPerType(
    chefProfileId: string,
  ): Promise<Map<ChefDocumentType, ChefDocument>> {
    const rows = await this.prisma.chefDocument.findMany({
      where: { chefProfileId },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });

    const latest = new Map<ChefDocumentType, ChefDocument>();
    for (const row of rows) if (!latest.has(row.type)) latest.set(row.type, row);
    return latest;
  }

  /** FLOW-01 §3.1 — hands out a signed URL; the file never transits the API. */
  async createUploadUrl(
    chefProfileId: string,
    wireType: string,
    body: CreateUploadUrlDto,
  ) {
    const type = this.parseManualType(wireType);
    const upload = await this.storage.createUploadUrl(
      this.prefix(chefProfileId),
      type,
      body.mimeType,
      body.sizeBytes,
    );

    return {
      uploadId: upload.uploadId,
      method: upload.method,
      url: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }

  /**
   * FLOW-01 §3.3 — records the deposit **after** confirming the object is really in
   * the bucket, and as a new version rather than an overwrite, so a document that
   * was refused and corrected keeps both deposits and the refusal reason.
   */
  async confirmUpload(
    chefProfileId: string,
    wireType: string,
    body: ConfirmUploadDto,
    requestId?: string,
  ) {
    const type = this.parseManualType(wireType);

    if (EXPIRING_DOCUMENT_TYPES.has(type) && !body.expiresOn) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: `expiresOn is required for "${toWire(type)}".`,
      });
    }
    if (body.expiresOn && new Date(body.expiresOn) <= new Date()) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'expiresOn must be in the future.',
      });
    }

    const storagePath = this.storage.buildPath(
      this.prefix(chefProfileId),
      type,
      body.uploadId,
    );
    // Refuses a confirm for a file that was never uploaded, which is how a dossier
    // would otherwise look complete with nothing behind it.
    const stat = await this.storage.statObject(storagePath);

    const previous = await this.prisma.chefDocument.findFirst({
      where: { chefProfileId, type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const document = await this.prisma.chefDocument.create({
      data: {
        chefProfileId,
        type,
        status: ChefDocumentStatus.submitted,
        version: (previous?.version ?? 0) + 1,
        storagePath,
        fileName: body.fileName ?? 'document',
        mimeType: stat.mimeType,
        sizeBytes: stat.sizeBytes,
        expiresOn: body.expiresOn ? new Date(body.expiresOn) : null,
      },
    });

    // Keeps an active candidature out of the 6-month abandonment purge.
    await this.prisma.chefApplication.updateMany({
      where: { chefProfileId },
      data: { lastActivityAt: new Date() },
    });

    await this.audit.record({
      actorType: 'chef',
      action: 'document.deposited',
      subjectType: 'chef_document',
      subjectId: document.id,
      requestId,
      metadata: {
        type: toWire(type),
        version: document.version,
        sizeBytes: stat.sizeBytes,
      },
    });

    return this.toView(document);
  }

  /**
   * Files a document the API produced (`SYSTEM_DOCUMENT_TYPES`) as the next version of
   * its type, already `valid`: nobody reviews a proof Stripe has just confirmed. Same
   * versioning as a deposit, so a re-signed mandate keeps the previous one on file.
   */
  async recordSystemDocument(
    chefProfileId: string,
    type: ChefDocumentType,
    file: { bytes: Buffer; fileName: string; mimeType: string },
    metadata: Record<string, unknown> = {},
  ): Promise<ChefDocument> {
    if (!SYSTEM_DOCUMENT_TYPES.has(type)) {
      throw new Error(`${type} is a chef deposit, not a document the API writes.`);
    }
    const storagePath = this.storage.buildPath(
      this.prefix(chefProfileId),
      type,
      `sys_${randomBytes(12).toString('hex')}`,
    );
    await this.storage.putObject(storagePath, file.bytes, file.mimeType);

    const previous = await this.prisma.chefDocument.findFirst({
      where: { chefProfileId, type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const now = new Date();
    const document = await this.prisma.chefDocument.create({
      data: {
        chefProfileId,
        type,
        status: ChefDocumentStatus.valid,
        version: (previous?.version ?? 0) + 1,
        storagePath,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
        submittedAt: now,
        decidedAt: now,
      },
    });

    await this.audit.record({
      actorType: 'system',
      action: 'document.generated',
      subjectType: 'chef_document',
      subjectId: document.id,
      metadata: { type: toWire(type), version: document.version, ...metadata },
    });
    return document;
  }

  /**
   * FLOW-01 §3.4 — a five-minute signed link to the latest deposit of one type, for
   * its owner or an admin. Served inline, so the browser shows the PDF or the image.
   * The read is journalled before the link is handed over: an identity document is
   * consulted, and every consultation is on the record.
   */
  async readLink(
    chefProfileId: string,
    wireType: string,
    reader: {
      actorType: AuditActorType;
      actorUserId: string;
      metadata?: Record<string, unknown>;
    },
    requestId?: string,
  ) {
    const type = this.parseType(wireType);
    const document = await this.prisma.chefDocument.findFirst({
      where: { chefProfileId, type },
      orderBy: { version: 'desc' },
    });
    if (!document) throw new NotFoundException('No document deposited for this type.');

    const link = await this.storage.createDownloadUrl(document.storagePath);
    await this.audit.record({
      actorType: reader.actorType,
      actorUserId: reader.actorUserId,
      action: 'document.read',
      subjectType: 'chef_document',
      subjectId: document.id,
      requestId,
      metadata: { ...reader.metadata, type: toWire(type), version: document.version },
    });

    return {
      ...link,
      type: toWire(type),
      version: document.version,
      mimeType: document.mimeType,
      fileName: document.fileName,
    };
  }

  /** FLOW-01 §7 — every deposit ever made for one type, newest first. */
  async versions(chefProfileId: string, wireType: string) {
    const type = this.parseType(wireType);
    const rows = await this.prisma.chefDocument.findMany({
      where: { chefProfileId, type },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * The dossier as the candidate or the chef sees it: every required document with
   * its current state, plus the derived dossier status.
   *
   * A required document with no row is `missing` — there is no placeholder row and
   * no stored `missing` status.
   */
  async dossier(
    chefProfileId: string,
    answers: Parameters<typeof requiredDocuments>[0],
    options: { disabled?: boolean } = {},
  ) {
    const latest = await this.latestPerType(chefProfileId);
    const required = requiredDocuments(answers);
    const seen = new Set(required.map((r) => r.type));

    const documents = required.map((req) => {
      const row = latest.get(req.type);
      return {
        type: toWire(req.type),
        label: req.label,
        family: req.family,
        required: req.required,
        status: row ? row.status : 'missing',
        version: row?.version ?? 0,
        fileName: row?.fileName ?? null,
        sizeBytes: row?.sizeBytes ?? null,
        submittedAt: row?.submittedAt ?? null,
        expiresOn: row?.expiresOn ?? null,
        reason: row?.reason ?? null,
        reasonCode: row?.reasonCode ?? null,
      };
    });

    // A document deposited before the answers changed (or an optional extra such as
    // the URSSAF vigilance certificate) still belongs in the dossier.
    for (const [type, row] of latest) {
      if (seen.has(type)) continue;
      documents.push({
        type: toWire(type),
        label: DOCUMENT_LABEL[type],
        family: DOCUMENT_FAMILY[type],
        required: false,
        status: row.status,
        version: row.version,
        fileName: row.fileName,
        sizeBytes: row.sizeBytes,
        submittedAt: row.submittedAt,
        expiresOn: row.expiresOn,
        reason: row.reason,
        reasonCode: row.reasonCode,
      });
    }

    const dossierStatus = this.deriveStatus(latest, answers, options.disabled);
    return {
      dossierStatus: toWire(dossierStatus),
      canApprove: dossierStatus === 'validated',
      documents,
    };
  }

  deriveStatus(
    latest: Map<ChefDocumentType, ChefDocument>,
    answers: Parameters<typeof requiredDocuments>[0],
    disabled?: boolean,
  ): DossierStatus {
    return deriveDossierStatus(
      [...latest.values()].map((row) => ({ type: row.type, status: row.status })),
      { answers, disabled },
    );
  }

  /** Answers as the rules need them, read off a candidature. */
  answersOf(application: ChefApplication) {
    return {
      workAuthorizationStatus: application.workAuthorizationStatus,
      companyLegalForm: application.companyLegalForm,
      sapPath: application.sapPath,
    };
  }

  toView(document: ChefDocument) {
    return {
      type: toWire(document.type),
      label: DOCUMENT_LABEL[document.type],
      family: DOCUMENT_FAMILY[document.type],
      status: document.status,
      fileName: document.fileName,
      sizeBytes: document.sizeBytes,
      submittedAt: document.submittedAt,
      expiresOn: document.expiresOn,
      version: document.version,
      reason: document.reason,
      reasonCode: document.reasonCode,
      decidedAt: document.decidedAt,
    };
  }
}
