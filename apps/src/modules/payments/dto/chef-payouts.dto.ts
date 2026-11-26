import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SearchPayoutChefsQueryDto {
  @ApiPropertyOptional({
    description:
      'Name, city, e-mail or booking reference. Empty: everyone with money to pay or awaited.',
    example: 'awa',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class ChefPayoutsQueryDto {
  @ApiPropertyOptional({ enum: ['payable', 'awaiting', 'paid'], default: 'payable' })
  @IsOptional()
  @IsIn(['payable', 'awaiting', 'paid'])
  view?: 'payable' | 'awaiting' | 'paid';

  @ApiPropertyOptional({
    description: 'Start of the period, included.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End of the period, excluded.',
    example: '2026-12-01',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** TEMPORAIRE: the Indy export's period (see accounting-export.service.ts). */
export class AccountingPeriodQueryDto {
  @ApiPropertyOptional({
    description: 'Start of the period, included.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End of the period, excluded.',
    example: '2026-12-01',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class MarkPayoutsPaidDto {
  @ApiProperty({
    description: 'Payable payouts of this batch cooker covered by the transfer.',
    example: ['5c1ebc99-9c0b-4ef8-bb6d-6bb9bd380a77'],
    maxItems: 200,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  payoutIds!: string[];

  @ApiPropertyOptional({
    description: 'The transfer label used.',
    example: 'LF VERSEMENT LF260142',
  })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  reference?: string;
}
