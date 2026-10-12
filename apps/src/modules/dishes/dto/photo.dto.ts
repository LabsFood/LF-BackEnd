import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Matches, Max, Min } from 'class-validator';

import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '../../../integrations/r2-storage.service';

const TYPES = Object.keys(PHOTO_TYPES);

export class PhotoUploadDto {
  @ApiProperty({ enum: TYPES, description: 'The picture’s type.', example: 'image/jpeg' })
  @IsIn(TYPES)
  contentType!: string;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_PHOTO_BYTES,
    description: `Its size in bytes, ${MAX_PHOTO_BYTES / (1024 * 1024)} MB at most.`,
    example: 482133,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PHOTO_BYTES)
  sizeBytes!: number;
}

export class PhotoConfirmDto {
  @ApiProperty({
    description: 'The `uploadId` step 1 gave.',
    example: 'ph_9f2a1c4e7b30d85a61c2e4f7',
  })
  @Matches(/^ph_[a-f0-9]{24}$/)
  uploadId!: string;

  @ApiProperty({
    enum: TYPES,
    description: 'The same type as in step 1.',
    example: 'image/jpeg',
  })
  @IsIn(TYPES)
  contentType!: string;
}

/** Step 1's answer, for the Swagger examples of every photo route. */
export const PHOTO_UPLOAD_EXAMPLE = {
  uploadId: 'ph_9f2a1c4e7b30d85a61c2e4f7',
  method: 'PUT',
  url: 'https://<account>.r2.cloudflarestorage.com/<bucket>/…/ph_9f2a….jpg?X-Amz-Signature=…',
  headers: { 'Content-Type': 'image/jpeg' },
  expiresAt: '2026-10-05T10:15:00.000Z',
};

/** The three steps, worded once for every photo route. `confirmPath` is step 3. */
export const photoStepsHelp = (confirmPath: string) =>
  'Three calls, and the file never goes through this API:\n\n' +
  '1. This call, with the picture’s type and size. It answers with a private `url` ' +
  'valid 15 minutes and an `uploadId`.\n' +
  '2. `PUT` the file to that `url`, with the `headers` given. Its length must be ' +
  'exactly `sizeBytes`: storage refuses anything else (403).\n' +
  `3. \`POST ${confirmPath}\` with the \`uploadId\` and \`contentType\`.\n\n` +
  'JPEG, PNG or WebP, 5 MB at most. Answers `503 PHOTOS_UNAVAILABLE` when this server ' +
  'has no photo storage.';
