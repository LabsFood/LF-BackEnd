import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length } from 'class-validator';

import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '../services/kyc-storage.service';

/** Body of `.../documents/:type/upload-url` (FLOW-01 §3.1). */
export class CreateUploadUrlDto {
  @ApiProperty({ example: 'cni-recto-verso.pdf' })
  @IsString()
  @Length(1, 255)
  fileName!: string;

  // Shape only. The accepted list and the size cap are enforced by
  // `KycStorageService.assertAcceptable`, which answers 422 as the flow document
  // specifies — validating them here too would return 400 from the pipe first.
  @ApiProperty({ enum: ALLOWED_MIME_TYPES, example: 'application/pdf' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ example: 842133, maximum: MAX_FILE_BYTES })
  @IsInt()
  sizeBytes!: number;
}

/** Body of `.../documents/:type/confirm` (FLOW-01 §3.3). */
export class ConfirmUploadDto {
  @ApiProperty({ example: 'up_9f2a1c4e7b30' })
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
      'Required for documents that lapse (identity, residence permit, renewal ' +
      'receipt, SAP receipt, RC Pro, HACCP, URSSAF vigilance).',
  })
  @IsOptional()
  @IsDateString()
  expiresOn?: string;
}

/** Admin decision on one document (FLOW-01 §5.2). */
export class DecideDocumentDto {
  @ApiProperty({ enum: ['valid', 'rejected'] })
  @IsIn(['valid', 'rejected'])
  decision!: 'valid' | 'rejected';

  @ApiPropertyOptional({
    minLength: 15,
    maxLength: 500,
    description:
      'Mandatory when refusing — the candidate reads it verbatim. 15 to 500 characters.',
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
    description: 'Feeds refusal statistics. Open list, not a database enum.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  reasonCode?: string;
}
