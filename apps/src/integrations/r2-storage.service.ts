import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

/** Dish and menu photos (FLOW-02) and account avatars: pictures only. */
export const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const UPLOAD_TTL_SECONDS = 15 * 60;

export interface R2Config {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  publicBaseUrl?: string;
}

/**
 * Every call into Cloudflare R2, where dish photos and batch cooker profile photos
 * live (PRD: public images are the high-egress case, and R2 has no egress fee). R2
 * speaks S3, so this is the AWS SDK pointed at R2. One provider, one
 * implementation; the KYC documents stay on Supabase.
 */
@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client?: S3Client;
  private readonly bucket?: string;
  private readonly publicBaseUrl?: string;

  constructor(config: ConfigService) {
    const r2 = config.get<R2Config>('r2', {});
    if (
      r2.accountId &&
      r2.accessKeyId &&
      r2.secretAccessKey &&
      r2.bucket &&
      r2.publicBaseUrl
    ) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${r2.accountId}.eu.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
        // Since SDK 3.729 a presigned PUT embeds a CRC32 of the empty body, which R2
        // then rejects against the browser's real upload.
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
      this.bucket = r2.bucket;
      this.publicBaseUrl = r2.publicBaseUrl.replace(/\/$/, '');
    }
  }

  get configured(): boolean {
    return Boolean(this.client);
  }

  private ensure(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException({
        code: 'PHOTOS_UNAVAILABLE',
        message:
          'Photo storage is not configured on this server (R2_* variables missing).',
      });
    }
    return { client: this.client, bucket: this.bucket };
  }

  /** The closed list of image types and the size cap, checked before any URL exists. */
  assertAcceptable(contentType: string, sizeBytes: number): string {
    const extension = PHOTO_TYPES[contentType];
    if (!extension) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Accepted formats: ${Object.keys(PHOTO_TYPES).join(', ')}.`,
      });
    }
    if (sizeBytes > MAX_PHOTO_BYTES) {
      throw new UnprocessableEntityException({
        code: 'FILE_TOO_LARGE',
        message: `Maximum accepted size is ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`,
      });
    }
    return extension;
  }

  /**
   * A presigned PUT for one object. Type and length are part of the signature, so
   * the browser cannot send something else under this URL; `head` checks again.
   */
  async createUploadUrl(key: string, contentType: string, sizeBytes: number) {
    const { client, bucket } = this.ensure();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      {
        expiresIn: UPLOAD_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      method: 'PUT' as const,
      url,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
    };
  }

  /** What really landed under `key`, or `null` if nothing did. */
  async head(key: string): Promise<{ sizeBytes: number; contentType: string } | null> {
    const { client, bucket } = this.ensure();
    try {
      const object = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        sizeBytes: object.ContentLength ?? 0,
        contentType: object.ContentType ?? '',
      };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  /**
   * What the file really is, read from its first bytes rather than the type it
   * was sent with: a signed `image/jpeg` header does not make the bytes a JPEG.
   */
  async sniff(key: string): Promise<string | null> {
    const { client, bucket } = this.ensure();
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-11' }),
    );
    const bytes = Buffer.from((await object.Body?.transformToByteArray()) ?? []);
    return detectImageType(bytes);
  }

  /**
   * The confirm step of every photo upload: something landed under `key`, within the
   * size cap, of the type announced, and its first bytes agree. Anything else is
   * deleted and refused, so a presigned URL cannot be used to host another file.
   */
  async assertUploaded(key: string, contentType: string): Promise<void> {
    const object = await this.head(key);
    if (!object) {
      throw new ConflictException({
        code: 'UPLOAD_NOT_CONFIRMED',
        message: 'No uploaded file was found for this upload id.',
      });
    }
    if (
      object.sizeBytes > MAX_PHOTO_BYTES ||
      object.contentType !== contentType ||
      (await this.sniff(key)) !== contentType
    ) {
      await this.delete(key);
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'The file sent does not match the type and size announced.',
      });
    }
  }

  /**
   * Step 1 of every photo upload: a fresh upload id and a presigned `PUT` for an
   * object under `folder`, so the upload cannot place a file anywhere else.
   */
  async presignPhoto(folder: string, contentType: string, sizeBytes: number) {
    this.assertAcceptable(contentType, sizeBytes);
    const uploadId = `ph_${randomBytes(12).toString('hex')}`;
    const signed = await this.createUploadUrl(
      photoKey(folder, uploadId, contentType),
      contentType,
      sizeBytes,
    );
    return { uploadId, ...signed };
  }

  /** Step 3: checks what landed under `folder`, and gives its key and public URL. */
  async confirmPhoto(folder: string, uploadId: string, contentType: string) {
    const key = photoKey(folder, uploadId, contentType);
    await this.assertUploaded(key, contentType);
    return { key, url: this.publicUrl(key) };
  }

  /** The object behind `url` only if it lives under `folder`: nothing else is ever deleted. */
  ownedKey(url: string | null, folder: string): string | null {
    const key = this.keyOf(url);
    return key?.startsWith(folder) ? key : null;
  }

  /** The address the public site loads the photo from. */
  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  /** The object key behind one of our public URLs, or `null` for any other URL. */
  keyOf(url: string | null): string | null {
    if (!url || !this.publicBaseUrl || !url.startsWith(`${this.publicBaseUrl}/`))
      return null;
    return url.slice(this.publicBaseUrl.length + 1);
  }

  /** Best-effort: an orphaned object costs storage, never correctness. */
  async delete(key: string): Promise<void> {
    if (!this.client || !this.bucket) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${(error as Error).message}`);
    }
  }
}

/** `folder` ends with `/`; the extension follows the announced type. */
const photoKey = (folder: string, uploadId: string, contentType: string) =>
  `${folder}${uploadId}.${PHOTO_TYPES[contentType]}`;

/** JPEG, PNG or WebP by their signatures; anything else is `null`. */
export function detectImageType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
