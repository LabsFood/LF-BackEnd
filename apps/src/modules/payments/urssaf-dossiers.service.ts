import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { AuditService } from '../../common/audit/audit.service';
import { cipherKey, open, seal } from '../../common/crypto/field-cipher';
import { GeoService } from '../../integrations/geo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KycStorageService } from '../chef-onboarding/services/kyc-storage.service';
import { UsersService } from '../users/users.service';
import {
  dossierProblems,
  ibanLast4,
  normalizeDossier,
  type UrssafDossier,
} from './domain/urssaf-dossier.rules';
import { sasIdentity } from './sas-identity';

const PROBLEM_MESSAGES: Record<string, string> = {
  REQUIRED: 'Required.',
  INVALID_NAME: 'Letters, spaces, hyphens and apostrophes only.',
  INVALID_DATE: 'A past date, as YYYY-MM-DD.',
  INVALID_COUNTRY: 'An INSEE country code (99100 for France).',
  INVALID_DEPARTMENT: 'A department code such as 075, 02A or 971.',
  INVALID_COMMUNE: 'An INSEE commune code such as 75056.',
  COMMUNE_NOT_IN_DEPARTMENT: 'This commune is not in the department given.',
  NOT_FOR_BIRTH_ABROAD: 'Leave it empty for a birth abroad.',
  INVALID_MOBILE: 'A French mobile number: 06, 07 or +33.',
  INVALID_EMAIL: 'An email address.',
  INVALID_POSTAL_CODE: 'Five digits.',
  INVALID_IBAN: 'This IBAN is not valid.',
  INVALID_BIC: 'A BIC of 8 or 11 characters.',
};

/**
 * The client's URSSAF dossier for the immediate advance, manual route: collected
 * here, entered by an admin on the intermediary's space (Unipros).
 *
 * Sealed (AES-256-GCM, `KYC_ENCRYPTION_KEY`) before it reaches the private KYC
 * bucket; Postgres only knows it exists. Nothing from it is ever logged: events
 * carry ids, failures `error.name`.
 */
@Injectable()
export class UrssafDossiersService {
  private readonly logger = new Logger(UrssafDossiersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly storage: KycStorageService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly geo: GeoService,
  ) {}

  /** `PUT /me/urssaf-dossier`: creates or replaces the whole dossier. */
  async save(clerkUserId: string, input: UrssafDossier) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const dossier = normalizeDossier(input);
    const problems = dossierProblems(dossier);
    if (problems.length > 0) {
      throw new UnprocessableEntityException({
        code: 'URSSAF_DOSSIER_INVALID',
        message: 'Some answers cannot be sent to URSSAF as they are.',
        errors: problems.map((p) => ({
          ...p,
          message: PROBLEM_MESSAGES[p.code] ?? p.code,
        })),
      });
    }

    // The town must be a commune of the postcode (ADDRESS_CITY_MISMATCH, naming the
    // right ones); fails closed when geo.api.gouv.fr does not answer.
    await this.geo.assertCommune(
      dossier.address.postalCode,
      dossier.address.city,
      'address.city',
    );

    const sealed = this.sealed(user.id, JSON.stringify(dossier));
    const previous = await this.prisma.urssafClientDossier.findUnique({
      where: { userId: user.id },
    });
    // A path is written once (`putObject` never overwrites): a new version, a new path.
    const storagePath = `clients/${user.id}/urssaf-dossier-${randomBytes(8).toString('hex')}.enc`;
    await this.storage.putObject(storagePath, sealed, 'application/octet-stream');
    const row = await this.prisma.urssafClientDossier.upsert({
      where: { userId: user.id },
      create: { userId: user.id, storagePath, ibanLast4: ibanLast4(dossier.iban) },
      update: { storagePath, ibanLast4: ibanLast4(dossier.iban) },
    });
    if (previous) await this.storage.removeObjects([previous.storagePath]);

    this.logger.log({ event: 'urssaf.dossier_saved', userId: user.id });
    return this.view(row, dossier);
  }

  /** `GET /me/urssaf-dossier`: the owner's answers, the IBAN reduced to its last four. */
  async mine(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const row = await this.prisma.urssafClientDossier.findUnique({
      where: { userId: user.id },
    });
    if (!row) {
      return {
        filled: false,
        filledAt: null,
        updatedAt: null,
        ibanLast4: null,
        dossier: null,
      };
    }
    return this.view(row, await this.read(user.id, row.storagePath));
  }

  /** `DELETE /me/urssaf-dossier`: the row and the sealed object go. */
  async remove(clerkUserId: string): Promise<void> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const row = await this.prisma.urssafClientDossier.findUnique({
      where: { userId: user.id },
    });
    if (!row) return;
    await this.prisma.urssafClientDossier.deleteMany({ where: { userId: user.id } });
    await this.storage.removeObjects([row.storagePath]);
    this.logger.log({ event: 'urssaf.dossier_deleted', userId: user.id });
  }

  /** Whether the client filled the dossier: the advance waits for it in manual mode. */
  async filled(userId: string): Promise<boolean> {
    return (await this.prisma.urssafClientDossier.count({ where: { userId } })) > 0;
  }

  /**
   * `GET /admin/urssaf-links/{id}/dossier`: everything, IBAN included, for the admin
   * to enter on the intermediary's space. Every reveal is audited.
   */
  async reveal(adminClerkUserId: string, linkId: string, requestId?: string) {
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    const link = await this.prisma.urssafLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        clientId: true,
        chefProfileId: true,
        chefProfile: { select: { sapProfile: { select: { novaCode: true } } } },
      },
    });
    if (!link) throw new NotFoundException('No enrolment with this id.');
    const row = await this.prisma.urssafClientDossier.findUnique({
      where: { userId: link.clientId },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'URSSAF_DOSSIER_MISSING',
        message: 'This client has not filled the URSSAF dossier yet.',
      });
    }
    const dossier = await this.read(link.clientId, row.storagePath);

    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'urssaf.dossier_revealed',
      subjectType: 'urssaf_link',
      subjectId: link.id,
      requestId,
    });
    this.logger.log({
      event: 'urssaf.dossier_revealed',
      linkId: link.id,
      adminId: admin.id,
    });
    return {
      linkId: link.id,
      clientId: link.clientId,
      chefProfileId: link.chefProfileId,
      // Dossier check only: the request is entered under `sapDeclarationNumber`.
      chefNovaCode: link.chefProfile.sapProfile?.novaCode ?? null,
      /** The SAS SAP declaration the request is entered under (MajorD 26/11). */
      sapDeclarationNumber: sasIdentity().sapDeclarationNumber,
      filledAt: row.filledAt,
      updatedAt: row.updatedAt,
      dossier,
    };
  }

  private view(
    row: { filledAt: Date; updatedAt: Date; ibanLast4: string },
    dossier: UrssafDossier,
  ) {
    const { iban: _iban, ...rest } = dossier;
    return {
      filled: true,
      filledAt: row.filledAt,
      updatedAt: row.updatedAt,
      ibanLast4: row.ibanLast4,
      dossier: rest,
    };
  }

  private key(userId: string): Buffer {
    try {
      return cipherKey(this.config.get<string>('urssaf.kycEncryptionKey'));
    } catch (error) {
      this.fail('urssaf.dossier_key_missing', userId, error);
    }
  }

  private sealed(userId: string, plaintext: string): Buffer {
    return Buffer.from(seal(plaintext, this.key(userId)), 'utf8');
  }

  private async read(userId: string, storagePath: string): Promise<UrssafDossier> {
    const key = this.key(userId);
    const body = await this.storage.getObject(storagePath);
    try {
      return JSON.parse(open(body.toString('utf8'), key)) as UrssafDossier;
    } catch (error) {
      this.fail('urssaf.dossier_unreadable', userId, error);
    }
  }

  private fail(event: string, userId: string, error: unknown): never {
    this.logger.error({
      event,
      userId,
      error: error instanceof Error ? error.name : 'unknown',
    });
    throw new ServiceUnavailableException({
      code: 'KYC_STORAGE_UNAVAILABLE',
      message: 'The URSSAF dossier cannot be read or stored right now.',
    });
  }
}
