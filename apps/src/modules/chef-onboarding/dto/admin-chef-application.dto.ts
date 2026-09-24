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
    description:
      'Keep one stage only. `submitted`: waiting for review. `changes-requested`: the ' +
      'candidate was asked to resend documents. `approved` / `rejected`: decided.',
    example: 'submitted',
  })
  @IsOptional()
  @IsIn(['submitted', 'changes-requested', 'approved', 'rejected'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Keep only dossiers with at least one document waiting for a decision.',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasPendingDocuments?: boolean;

  @ApiPropertyOptional({
    description: 'Search the name, email, city and reference.',
    example: 'Dupont',
  })
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
      '`true` makes the batch cooker bookable right away. By default they are verified ' +
      'but stay offline, to be put online later with `PATCH /admin/chefs/{id}/verification`.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Internal note, kept in the audit log. The candidate never sees it.',
    example: "Dossier complet. Vitrine à activer après l'appel de bienvenue.",
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;
}

/** Body of `POST /admin/chef-applications/:id/reject` (FLOW-01 §6). */
export class RejectApplicationDto {
  @ApiProperty({
    minLength: 15,
    maxLength: 500,
    description: 'Why. Emailed to the candidate and shown in their space, word for word.',
    example:
      "Zone d'intervention non couverte pour l'instant : nous ne travaillons pas encore en Corse.",
  })
  @IsString()
  @Length(15, 500)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'A short code for statistics. Usual values: `out-of-area`, `incomplete-dossier`, ' +
      '`not-eligible`, `other` (the default). Other values are accepted.',
    example: 'out-of-area',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  reasonCode?: string;

  @ApiPropertyOptional({
    example: '2027-01-01',
    description:
      'The day the candidate may apply again, shown to them. Leave it out to let them ' +
      'apply again at any time.',
  })
  @IsOptional()
  @IsDateString()
  allowReapplyAfter?: string;
}
