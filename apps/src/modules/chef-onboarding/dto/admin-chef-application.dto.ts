import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { DOCUMENT_TYPES } from '../domain/chef-onboarding.rules';

/** Query for the admin review queue (FLOW-01 §5.1). */
export class ListChefApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['submitted', 'changes-requested', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsIn(['submitted', 'changes-requested', 'approved', 'rejected'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Keep only dossiers with at least one document awaiting a decision.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasPendingDocuments?: boolean;

  @ApiPropertyOptional({ description: 'Free text over name, email, city and reference.' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;
}

/** Body of `POST /admin/chef-applications/:id/request-changes` (FLOW-01 §5.4). */
export class RequestChangesDto {
  @ApiProperty({
    minLength: 15,
    maxLength: 1000,
    description: 'What the candidate should do. Sent to them by email, word for word.',
    example:
      "Votre attestation RC Pro s'arrête au 31/12/2026. Pouvez-vous envoyer celle de l'année en cours ?",
  })
  @IsString()
  @Length(15, 1000)
  message!: string;

  @ApiProperty({
    enum: DOCUMENT_TYPES,
    isArray: true,
    description: 'The documents the candidate should send again. At least one.',
    example: ['rc-pro'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  documentTypes!: string[];
}

/** Body of `POST /admin/chef-applications/:id/approve` (FLOW-01 §6). */
export class ApproveApplicationDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Whether the batch cooker is immediately bookable. Defaults to false: ' +
      'vetted, but not yet published.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Internal note for the audit trail.',
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;
}

/** Body of `POST /admin/chef-applications/:id/reject` (FLOW-01 §6). */
export class RejectApplicationDto {
  @ApiPropertyOptional({
    minLength: 15,
    maxLength: 500,
    description: 'Sent to the candidate verbatim.',
  })
  @IsString()
  @Length(15, 500)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Open list: `out-of-area`, `incomplete-dossier`, `not-eligible`, `other`.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  reasonCode?: string;

  @ApiPropertyOptional({
    example: '2027-01-01',
    description: 'Date from which the candidate may apply again.',
  })
  @IsOptional()
  @IsDateString()
  allowReapplyAfter?: string;
}
