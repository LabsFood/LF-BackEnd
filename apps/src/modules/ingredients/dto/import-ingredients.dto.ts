import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString, MaxLength } from 'class-validator';

import { OptionalNotNull, Raw } from '../../../common/dto/strict';

/**
 * Recettes §7.4, ruling R29: at most 500,000 characters. The body limit is Fastify's
 * default 1 MiB, which a 2,000,000-character file could never reach (a generic 413);
 * 500,000 fits it even at 2 bytes a character and with JSON escaping. The starting
 * list is about 51 KB.
 */
export const IMPORT_MAX_CHARACTERS = 500_000;

export class ImportIngredientsDto {
  @ApiProperty({
    maxLength: IMPORT_MAX_CHARACTERS,
    description:
      'The CSV text: separator `;`, lists inside a cell separated by `|`, booleans ' +
      '`oui`/`non`, a header row with the columns `nom;autres_noms;rayon;allergenes;' +
      'aucun_allergene;regimes;mois;base;doute` in any order (`doute` is ignored). ' +
      '500,000 characters and 2,000 ingredient lines at most.',
    example:
      'nom;autres_noms;rayon;allergenes;aucun_allergene;regimes;mois;base;doute\n' +
      'Tomate;pomme d’amour;fruits-legumes;;oui;vegan|gluten-free;6|7|8|9;non;',
  })
  @Raw()
  @IsString()
  @MaxLength(IMPORT_MAX_CHARACTERS)
  csv!: string;

  @ApiPropertyOptional({
    description: 'True writes the import; absent or false only simulates it.',
    default: false,
  })
  @OptionalNotNull()
  @Raw()
  @IsBoolean()
  confirm?: boolean;
}
