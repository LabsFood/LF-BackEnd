import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Shape only: the rules URSSAF applies (name charset, mobile, birth place, IBAN
 * checksum) are `domain/urssaf-dossier.rules.ts`, answered as 422
 * `URSSAF_DOSSIER_INVALID` with one entry per field.
 */
export class UrssafDossierAddressDto {
  @ApiProperty({ example: '12 rue des Lilas', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  line1!: string;

  @ApiPropertyOptional({ example: 'Bâtiment B', maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  line2?: string | null;

  @ApiProperty({ example: '75011', maxLength: 10 })
  @IsString()
  @MaxLength(10)
  postalCode!: string;

  @ApiProperty({ example: 'Paris', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  city!: string;

  @ApiProperty({ description: 'INSEE country code, 99100 for France.', example: '99100' })
  @IsString()
  @MaxLength(5)
  countryCode!: string;
}

export class UrssafDossierDto {
  @ApiProperty({ enum: ['M', 'F'], example: 'F' })
  @IsIn(['M', 'F'])
  civility!: 'M' | 'F';

  @ApiProperty({ example: 'Marchand', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  birthName!: string;

  @ApiPropertyOptional({ example: null, maxLength: 80, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  usageName?: string | null;

  @ApiProperty({ description: 'Every first name, in order.', example: 'Sophie Anne' })
  @IsString()
  @MaxLength(80)
  firstNames!: string;

  @ApiProperty({ example: '1981-04-12', description: 'YYYY-MM-DD.' })
  @IsString()
  @MaxLength(10)
  birthDate!: string;

  @ApiProperty({ description: 'INSEE country code, 99100 for France.', example: '99100' })
  @IsString()
  @MaxLength(5)
  birthCountryCode!: string;

  @ApiPropertyOptional({
    description: 'Birth in France only: 075, 02A, 971. Leave out for a birth abroad.',
    example: '075',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  birthDepartmentCode?: string | null;

  @ApiPropertyOptional({
    description: 'Birth in France only: INSEE commune code.',
    example: '75056',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  birthCommuneCode?: string | null;

  @ApiPropertyOptional({ example: 'Paris', maxLength: 80, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  birthCommuneName?: string | null;

  @ApiProperty({
    description: 'French mobile: 06, 07 or +33.',
    example: '06 12 34 56 78',
  })
  @IsString()
  @MaxLength(20)
  mobilePhone!: string;

  @ApiProperty({ example: 'sophie@exemple.fr', maxLength: 320 })
  @IsString()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ type: UrssafDossierAddressDto })
  // `@ValidateNested` alone lets a missing address through, and the rules read its lines.
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UrssafDossierAddressDto)
  address!: UrssafDossierAddressDto;

  @ApiProperty({
    description: 'The account URSSAF debits. Never returned to the client afterwards.',
    example: 'FR76 3000 6000 0112 3456 7890 189',
  })
  @IsString()
  @MaxLength(42)
  iban!: string;

  @ApiProperty({ example: 'AGRIFRPP' })
  @IsString()
  @MaxLength(15)
  bic!: string;

  @ApiProperty({ example: 'Sophie Marchand', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  accountHolder!: string;
}
