import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Recettes §7.4: about 2 MB of text. */
export const IMPORT_MAX_CHARACTERS = 2_000_000;

export class ImportIngredientsDto {
  @ApiProperty({
    maxLength: IMPORT_MAX_CHARACTERS,
    description:
      'The CSV text: separator `;`, lists inside a cell separated by `|`, booleans ' +
      '`oui`/`non`, a header row with the columns `nom;autres_noms;rayon;allergenes;' +
      'aucun_allergene;regimes;mois;base;doute` in any order (`doute` is ignored). ' +
      '2,000 ingredient lines at most.',
    example:
      'nom;autres_noms;rayon;allergenes;aucun_allergene;regimes;mois;base;doute\n' +
      'Tomate;pomme d’amour;fruits-legumes;;oui;vegan|gluten-free;6|7|8|9;non;',
  })
  @IsString()
  @MaxLength(IMPORT_MAX_CHARACTERS)
  csv!: string;

  @ApiPropertyOptional({
    description: 'True writes the import; absent or false only simulates it.',
    default: false,
  })
  @IsOptional()
  // The raw value: implicit conversion has already turned "false" into true.
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key])
  @IsBoolean()
  confirm?: boolean;
}
