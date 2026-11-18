import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';

import { CHEF_LEGAL_STATUSES, VAT_REGIMES } from '../chef-legal.views';

/**
 * The batch cooker's legal identity, shown to clients before they book (CGV art.
 * 3.2). Each field: absent leaves it, `null` clears it.
 */
export class UpdateChefLegalDto {
  @ApiPropertyOptional({
    description: 'Company name, or « Prénom Nom EI » for a sole trader.',
    example: 'Marie Dupont EI',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  legalName?: string | null;

  @ApiPropertyOptional({
    enum: CHEF_LEGAL_STATUSES,
    nullable: true,
    example: 'micro_entreprise',
  })
  @IsOptional()
  @IsIn(CHEF_LEGAL_STATUSES)
  legalStatus?: string | null;

  @ApiPropertyOptional({
    description: '9 digits, checked with their Luhn key.',
    example: '443061841',
    nullable: true,
  })
  @IsOptional()
  @Matches(/^\d{9}$/, { message: 'siren must be 9 digits' })
  siren?: string | null;

  @ApiPropertyOptional({
    description: 'The professional address, published as is.',
    example: '5 rue du Marché, 93100 Montreuil',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  businessAddress?: string | null;

  @ApiPropertyOptional({
    enum: VAT_REGIMES,
    description:
      '`franchise`: « TVA non applicable, article 293 B du CGI ». `subject`: charges ' +
      'VAT, with `vatNumber`.',
    nullable: true,
  })
  @IsOptional()
  @IsIn(VAT_REGIMES)
  vatRegime?: string | null;

  @ApiPropertyOptional({ example: 'FR12443061841', nullable: true })
  @IsOptional()
  @Matches(/^FR[0-9A-Z]{2}\d{9}$/, { message: 'vatNumber must be a French VAT number' })
  vatNumber?: string | null;

  @ApiPropertyOptional({ example: 'MAAF Pro', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  insurerName?: string | null;

  @ApiPropertyOptional({
    description: 'What the professional insurance covers.',
    example: 'RC Pro, 2 000 000 € par sinistre',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  insuranceCoverage?: string | null;

  @ApiPropertyOptional({
    description: 'The consumer mediator the batch cooker belongs to (CGV art. 23.2).',
    example: 'CM2C',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  mediatorName?: string | null;

  @ApiPropertyOptional({ example: 'https://www.cm2c.net', nullable: true })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(1, 255)
  mediatorUrl?: string | null;
}

export class ChefLegalDto extends UpdateChefLegalDto {
  @ApiProperty({
    nullable: true,
    description: 'From the SAP declaration, read-only here.',
  })
  sapNumber!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'What a client cannot see yet: `name`, `legalStatus`, `siren`, `businessAddress`, ' +
      '`vat`, `insurance`, `mediator`. Nothing blocks a booking meanwhile.',
    example: ['insurance', 'mediator'],
  })
  missing!: string[];
}
