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

export const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Read links are short-lived: a link copied out of a thread soon stops working. */
export const ATTACHMENT_URL_TTL_SECONDS = 5 * 60;

const UPLOAD_ID = /^up_[0-9a-f]{24}$/;

export interface SignedAttachmentUpload {
  uploadId: string;
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Object storage for the files sent in conversations.
 *
 * Same contract as the KYC documents: a private Supabase bucket, a signed PUT so
 * the file never transits the API, and a signed GET to read. A bucket of its own,
 * so that the retention rules of identity documents never apply to chat files.
 */
@Injectable()
export class MessagingStorageService {
  private readonly logger = new Logger(MessagingStorageService.name);
  private readonly bucket: string;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
  ) {
    this.bucket = config.get<string>('supabase.messagingBucket', 'labsfood-messages');
  }

  private bucketApi() {
    if (!this.supabase.configured) {
      throw new ServiceUnavailableException({
        code: 'ATTACHMENTS_UNAVAILABLE',
        message: 'File storage is not configured.',
      });
    }
    return this.supabase.getClient().storage.from(this.bucket);
  }

  /**
   * Where one upload lives. The conversation and the uploader come from the
   * authorised request, so nobody can attach a file uploaded by someone else or
   * for another thread.
   */
  pathFor(conversationId: string, uploaderUserId: string, uploadId: string): string {
    if (!UPLOAD_ID.test(uploadId)) {
      throw new UnprocessableEntityException({
        code: 'UPLOAD_NOT_CONFIRMED',
        message: 'Unknown upload id.',
      });
    }
    return `conversations/${conversationId}/${uploaderUserId}/${uploadId}`;
  }

  assertAcceptable(mimeType: string, sizeBytes: number): void {
    if (
      !ALLOWED_ATTACHMENT_TYPES.includes(
        mimeType as (typeof ALLOWED_ATTACHMENT_TYPES)[number],
      )
    ) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Accepted formats: ${ALLOWED_ATTACHMENT_TYPES.join(', ')}.`,
      });
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'sizeBytes must be a positive integer.',
      });
    }
    if (sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new UnprocessableEntityException({
        code: 'FILE_TOO_LARGE',
        message: `Maximum accepted size is ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
      });
    }
  }

  async createUploadUrl(
    conversationId: string,
    uploaderUserId: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<SignedAttachmentUpload> {
    this.assertAcceptable(mimeType, sizeBytes);

    const uploadId = `up_${randomBytes(12).toString('hex')}`;
    const storagePath = this.pathFor(conversationId, uploaderUserId, uploadId);

    const { data, error } = await this.bucketApi().createSignedUploadUrl(storagePath);
    if (error || !data) {
      this.logger.error(`Signed upload URL failed for ${storagePath}: ${error?.message}`);
      throw new ServiceUnavailableException({
        code: 'ATTACHMENTS_UNAVAILABLE',
        message: 'Could not prepare the upload.',
      });
    }

    return {
      uploadId,
      method: 'PUT',
      url: data.signedUrl,
      headers: { 'Content-Type': mimeType },
      // Fixed by Supabase, not configurable.
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    };
  }

  /**
   * Confirms the file really landed and is what was announced: the type and the
   * size are read from the bucket, not trusted from the request.
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
    const stat = {
      sizeBytes: Number(data.size ?? 0),
      mimeType: String(data.contentType ?? 'application/octet-stream'),
    };
    this.assertAcceptable(stat.mimeType, stat.sizeBytes);
    return stat;
  }

  async createDownloadUrl(
    storagePath: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const { data, error } = await this.bucketApi().createSignedUrl(
      storagePath,
      ATTACHMENT_URL_TTL_SECONDS,
    );
    if (error || !data) {
      this.logger.error(`Signed read URL failed for ${storagePath}: ${error?.message}`);
      throw new BadRequestException('Could not produce a download link.');
    }
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + ATTACHMENT_URL_TTL_SECONDS * 1000),
    };
  }
}
