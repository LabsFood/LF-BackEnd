import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { SupabaseService } from '../../../integrations/supabase.service';

/** FLOW-01 §3.1 — anything else is refused before a URL is handed out. */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Read links, the owner's as an admin's, are deliberately short-lived (FLOW-01 §3.4). */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface SignedUpload {
  uploadId: string;
  storagePath: string;
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Every call into object storage lives here.
 *
 * Not an abstraction over storage providers — there is one provider and one
 * implementation. It is a single place to change if KYC files ever move off
 * Supabase, which keeps that a one-file rewrite instead of a refactor.
 *
 * The bucket is private: nothing here ever produces a public URL.
 */
@Injectable()
export class KycStorageService {
  private readonly logger = new Logger(KycStorageService.name);
  private readonly bucket: string;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
  ) {
    this.bucket = config.get<string>('supabase.kycBucket', 'labsfood-kyc');
  }

  get configured(): boolean {
    return this.supabase.configured;
  }

  private bucketApi() {
    if (!this.supabase.configured) {
      throw new ServiceUnavailableException(
        'Document storage is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY missing).',
      );
    }
    return this.supabase.getClient().storage.from(this.bucket);
  }

  /**
   * Object key for one deposit. The owner prefix comes from the authorised route
   * parameters, so a candidate can only ever confirm a file under their own
   * candidature and document type.
   */
  buildPath(ownerPrefix: string, type: string, uploadId: string): string {
    return `${ownerPrefix}/${type}/${uploadId}`;
  }

  assertAcceptable(mimeType: string, sizeBytes: number): void {
    if (!ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Accepted formats: ${ALLOWED_MIME_TYPES.join(', ')}.`,
      });
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'sizeBytes must be a positive integer.',
      });
    }
    if (sizeBytes > MAX_FILE_BYTES) {
      throw new UnprocessableEntityException({
        code: 'FILE_TOO_LARGE',
        message: `Maximum accepted size is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
      });
    }
  }

  /**
   * FLOW-01 §3.1. The file goes straight from the browser to the bucket and never
   * transits the API.
   *
   * Supabase fixes the upload token lifetime at two hours; it is not configurable.
   * That is wider than the 15 minutes the flow document sketches, but the token is
   * single-path and the deposit only counts once `confirm` has verified the object.
   */
  async createUploadUrl(
    ownerPrefix: string,
    type: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<SignedUpload> {
    this.assertAcceptable(mimeType, sizeBytes);

    const uploadId = `up_${randomBytes(12).toString('hex')}`;
    const storagePath = this.buildPath(ownerPrefix, type, uploadId);

    const { data, error } = await this.bucketApi().createSignedUploadUrl(storagePath);
    if (error || !data) {
      this.logger.error(`Signed upload URL failed for ${storagePath}: ${error?.message}`);
      throw new ServiceUnavailableException('Could not prepare the upload.');
    }

    return {
      uploadId,
      storagePath,
      method: 'PUT',
      url: data.signedUrl,
      headers: { 'Content-Type': mimeType },
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    };
  }

  /**
   * Confirms the object really landed, and returns its true size.
   *
   * Without this the API would record a deposit for a file that was never uploaded,
   * which is how a dossier ends up "complete" with nothing behind it.
   */
  async statObject(
    storagePath: string,
  ): Promise<{ sizeBytes: number; mimeType: string }> {
    const { data, error } = await this.bucketApi().info(storagePath);
    if (error || !data) {
      throw new ConflictException({
        code: 'UPLOAD_NOT_CONFIRMED',
        message: 'No uploaded file was found for this upload id.',
      });
    }
    return {
      sizeBytes: Number(data.size ?? 0),
      mimeType: String(data.contentType ?? 'application/octet-stream'),
    };
  }

  /**
   * Short-lived read link for an admin or the owning chef (FLOW-01 §3.4). Inline:
   * without Supabase's `download` option the browser displays the file.
   */
  async createDownloadUrl(
    storagePath: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const { data, error } = await this.bucketApi().createSignedUrl(
      storagePath,
      DOWNLOAD_URL_TTL_SECONDS,
    );
    if (error || !data) {
      this.logger.error(`Signed read URL failed for ${storagePath}: ${error?.message}`);
      throw new BadRequestException('Could not produce a download link.');
    }
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  /** Retention purge (FLOW-01 §8). Best-effort: a failure is logged, not thrown. */
  async removeObjects(storagePaths: string[]): Promise<void> {
    if (storagePaths.length === 0) return;
    const { error } = await this.bucketApi().remove(storagePaths);
    if (error) {
      this.logger.error(
        `Purge failed for ${storagePaths.length} objects: ${error.message}`,
      );
    }
  }
}
