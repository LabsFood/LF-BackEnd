import { ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length } from 'class-validator';

import { DOCUMENT_TYPES } from '../domain/chef-onboarding.rules';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '../services/kyc-storage.service';

/** The `{type}` path parameter, shared by every route that addresses one document. */
export const ApiDocumentTypeParam = (): MethodDecorator =>
  ApiParam({
    name: 'type',
    enum: DOCUMENT_TYPES,
    description:
      'Which document. `identity` and `registration` are blocking: approval waits for ' +
      'them. Any other value answers 404.',
    example: 'identity',
  });

/** Body of `.../documents/:type/upload-url` (FLOW-01 §3.1). */
export class CreateUploadUrlDto {
  @ApiProperty({
    description: 'The file name on the device, kept to show it back in the dossier.',
    example: 'cni-recto-verso.pdf',
  })
  @IsString()
  @Length(1, 255)
  fileName!: string;

  // Shape only. The accepted list and the size cap are enforced by
  // `KycStorageService.assertAcceptable`, which answers 422 as the flow document
  // specifies — validating them here too would return 400 from the pipe first.
  @ApiProperty({
    enum: ALLOWED_MIME_TYPES,
    description: 'The file type. PDF, JPEG, PNG or WebP; anything else answers 422.',
    example: 'application/pdf',
  })
  @IsString()
  mimeType!: string;

  @ApiProperty({
    description: 'The file size in bytes. 10 MB at most, or 422.',
    example: 842133,
    maximum: MAX_FILE_BYTES,
  })
  @IsInt()
  sizeBytes!: number;
}

/** Body of `.../documents/:type/confirm` (FLOW-01 §3.3). */
export class ConfirmUploadDto {
  @ApiProperty({
    description: 'The `uploadId` returned by `upload-url`.',
    example: 'up_9f2a1c4e7b30d85a61c2e4f7',
  })
  @IsString()
  @Length(1, 128)
  uploadId!: string;

  @ApiPropertyOptional({
    example: 'cni-recto-verso.pdf',
    description:
      'Original file name, echoed back in the dossier. Carried here rather than ' +
      'remembered from `upload-url`, which would need a pending row for every ' +
      'abandoned upload.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  fileName?: string;

  @ApiPropertyOptional({
    example: '2028-03-14',
    description:
      'The day the document stops being valid, as printed on it. Required for ' +
      '`identity`, `residence-permit`, `renewal-receipt`, `sap-declaration`, `rc-pro`, ' +
      '`haccp` and `vigilance`; must be in the future. Reminders go out 60, 30 and 7 ' +
      'days before.',
  })
  @IsOptional()
  @IsDateString()
  expiresOn?: string;
}

/** Admin decision on one document (FLOW-01 §5.2). */
export class DecideDocumentDto {
  @ApiProperty({
    enum: ['valid', 'rejected'],
    description:
      '`valid` accepts the document. `rejected` refuses it and needs a `reason`.',
    example: 'rejected',
  })
  @IsIn(['valid', 'rejected'])
  decision!: 'valid' | 'rejected';

  @ApiPropertyOptional({
    minLength: 15,
    maxLength: 500,
    description:
      'Required when refusing. Emailed to the candidate and shown in their dossier, ' +
      'word for word, so say what to send instead.',
    example:
      "L'extrait date de plus de 3 mois. Merci d'envoyer un avis de situation récent.",
  })
  @IsOptional()
  @IsString()
  @Length(15, 500)
  reason?: string;

  @ApiPropertyOptional({
    enum: [
      'unreadable',
      'expired',
      'incomplete',
      'wrong-document',
      'name-mismatch',
      'suspected-forgery',
      'other',
    ],
    description:
      'A short code for statistics. `other` when left out. Other values are accepted.',
    example: 'expired',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  reasonCode?: string;
}
