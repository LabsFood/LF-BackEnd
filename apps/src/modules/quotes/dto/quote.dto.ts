import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  Matches,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import {
  MAX_NET_CENTS,
  MAX_VALIDITY_DAYS,
  MIN_NET_CENTS,
  MIN_VALIDITY_DAYS,
  QUOTE_STATUSES,
  QUOTE_STATUS_HELP,
  TIME_SLOT_KEYS,
  TimeSlot,
} from '../domain/quote.rules';

export { QUOTE_STATUSES, QUOTE_STATUS_HELP };

/**
 * Nothing a person types is trusted: every text is cleaned before it is checked,
 * and checked before it is stored. The browser's own checks are a courtesy.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** A one-line field: no control character, no line break, spaces collapsed. */
const oneLine = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
    : value;

/** A free text: line breaks kept, control characters and trailing blanks removed. */
const text = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.replace(CONTROL, '').replace(/\r\n?/g, '\n').trim()
    : value;

/** A list of labels: each one cleaned, empty ones dropped, doubles removed. */
const labels = ({ value }: { value: unknown }) => {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  return value.filter((item) => {
    if (typeof item !== 'string') return true; // left for `IsString` to refuse
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const cleanLabels = ({ value }: { value: unknown }) =>
  labels({
    value: Array.isArray(value)
      ? value.map((item: unknown) => oneLine({ value: item }))
      : value,
  });

/** At least one letter: a title of dashes or digits says nothing. */
const HAS_LETTER = /\p{L}/u;
const CITY = /^\p{L}[\p{L} .'’-]*$/u;
/** Metropolitan France and overseas departments: five digits. */
const POSTAL_CODE = /^\d{5}$/;

export const MAX_BUDGET_CENTS = 10_000_000; // 100 000 €

const SLOT_HELP =
  '`morning` (9 h–13 h), `afternoon` (14 h–18 h) or `evening` (18 h–22 h), Paris time.';

export class CreateQuoteDto {
  @ApiProperty({
    description: 'Short label for the event or request.',
    example: 'Dîner d’anniversaire pour 12',
    maxLength: 255,
  })
  @Transform(oneLine)
  @IsString()
  @Length(3, 255)
  @Matches(HAS_LETTER, { message: 'title must contain letters' })
  title!: string;

  @ApiPropertyOptional({
    description:
      'The batch cooker the client wants (`id` in `GET /chefs/{id}`). Must be ' +
      'verified. Left out: an admin gives the request to one.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsOptional()
  @IsUUID()
  chefProfileId?: string;

  @ApiPropertyOptional({ example: 'Anniversaire', maxLength: 160 })
  @IsOptional()
  @Transform(oneLine)
  @IsString()
  @MaxLength(160)
  occasion?: string;

  @ApiProperty({
    description:
      'The day wanted for the prestation (`YYYY-MM-DD`), tomorrow at the earliest.',
    example: '2026-11-14',
  })
  @IsDateString({ strict: true })
  @Length(10, 10)
  desiredDate!: string;

  @ApiProperty({ enum: TIME_SLOT_KEYS, description: SLOT_HELP, example: 'evening' })
  @IsIn(TIME_SLOT_KEYS)
  timeSlot!: TimeSlot;

  @ApiProperty({ minimum: 1, maximum: 200, example: 12 })
  @IsInt()
  @Min(1)
  @Max(200)
  persons!: number;

  @ApiProperty({
    minimum: 1,
    maximum: 50,
    description: 'Number of dishes wanted.',
    example: 3,
  })
  @IsInt()
  @Min(1)
  @Max(50)
  mealsCount!: number;

  @ApiProperty({
    description: 'Desired cuisine style or region.',
    example: 'Méditerranéenne',
    maxLength: 120,
  })
  @Transform(oneLine)
  @IsString()
  @Length(2, 120)
  @Matches(HAS_LETTER, { message: 'cuisine must contain letters' })
  cuisine!: string;

  @ApiPropertyOptional({ type: [String], example: ['végétarien'] })
  @IsOptional()
  @Transform(cleanLabels)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  diet?: string[];

  @ApiPropertyOptional({ type: [String], example: ['gluten', 'fruits à coque'] })
  @IsOptional()
  @Transform(cleanLabels)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  allergies?: string[];

  @ApiProperty({
    description: 'What the client wants, in their words.',
    example: 'Dîner dans le jardin, service simple, dessert indispensable.',
    maxLength: 4000,
  })
  @Transform(text)
  @IsString()
  @Length(10, 4000)
  @Matches(HAS_LETTER, { message: 'brief must contain letters' })
  brief!: string;

  @ApiProperty({
    description:
      'Where the prestation takes place. The batch cooker only sees the city and ' +
      'the postcode until an offer is accepted.',
    example: '12 rue des Lilas',
    maxLength: 255,
  })
  @Transform(oneLine)
  @IsString()
  @Length(3, 255)
  @Matches(HAS_LETTER, { message: 'addressLine must contain a street name' })
  addressLine!: string;

  @ApiProperty({ example: 'Nice', maxLength: 120 })
  @Transform(oneLine)
  @IsString()
  @Length(1, 120)
  @Matches(CITY, { message: 'addressCity must be a town name' })
  addressCity!: string;

  @ApiProperty({ example: '06000', pattern: '^\\d{5}$', description: 'French postcode.' })
  @Transform(oneLine)
  @IsString()
  @Matches(POSTAL_CODE, { message: 'addressPostalCode must be 5 digits' })
  addressPostalCode!: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_BUDGET_CENTS,
    description: 'A budget hint for the batch cooker, in cents. Not a commitment.',
    example: 40000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BUDGET_CENTS)
  budgetCents?: number;
}

/** The fields an admin may correct on a request. Never the client's address. */
class EditableQuoteFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(oneLine)
  @IsString()
  @Length(3, 255)
  @Matches(HAS_LETTER, { message: 'title must contain letters' })
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  persons?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  mealsCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(oneLine)
  @IsString()
  @Length(2, 120)
  @Matches(HAS_LETTER, { message: 'cuisine must contain letters' })
  cuisine?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(cleanLabels)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  diet?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(text)
  @IsString()
  @Length(10, 4000)
  @Matches(HAS_LETTER, { message: 'brief must contain letters' })
  brief?: string;
}

export class UpdateQuoteAdminDto extends PartialType(EditableQuoteFieldsDto) {
  @ApiPropertyOptional({
    enum: ['submitted', 'in_review'],
    description:
      '`in_review` to show the team is on it, `submitted` to put it back. The other ' +
      'statuses follow what the batch cooker and the client do: they cannot be set.',
  })
  @IsOptional()
  @IsIn(['submitted', 'in_review'])
  status?: 'submitted' | 'in_review';

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The batch cooker who takes the request: their account id (`userId` in ' +
      '`GET /admin/chefs`). Only a verified batch cooker can be assigned, else ' +
      '`422 CHEF_NOT_ASSIGNABLE`. Send `null` to unassign.\n\n' +
      'Assigning puts the request back to `submitted`, withdraws an offer the ' +
      'previous batch cooker left open, and emails the new one.',
    example: 'f5eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
  })
  // Left out: untouched. `null`: unassign. Anything else must be a uuid.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  assignedChefUserId?: string | null;
}

/** Body of `POST …/quotes/:id/offers`. */
export class CreateQuoteOfferDto {
  @ApiProperty({
    minimum: MIN_NET_CENTS,
    maximum: MAX_NET_CENTS,
    description:
      'What the batch cooker wants to receive, in cents. The API adds the platform ' +
      'commission to get the client price, and returns both.',
    example: 17000,
  })
  @IsInt()
  @Min(MIN_NET_CENTS)
  @Max(MAX_NET_CENTS)
  netCents!: number;

  @ApiPropertyOptional({
    minimum: MIN_VALIDITY_DAYS,
    maximum: MAX_VALIDITY_DAYS,
    default: 7,
    description: 'How many days the client has to answer. After that the offer expires.',
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_VALIDITY_DAYS)
  @Max(MAX_VALIDITY_DAYS)
  validityDays?: number;

  @ApiPropertyOptional({
    description: 'What is included, what is not: shopping, travel, service.',
    example: 'Courses incluses. Déplacement compris dans un rayon de 30 km.',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(text)
  @IsString()
  @MaxLength(2000)
  conditions?: string;

  @ApiPropertyOptional({
    description:
      'Another day than the one asked (`YYYY-MM-DD`), when the batch cooker is not ' +
      'free then. Left out: the day the client asked for.',
    example: '2026-11-15',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Length(10, 10)
  proposedDate?: string;

  @ApiPropertyOptional({
    enum: TIME_SLOT_KEYS,
    description: `Another slot. ${SLOT_HELP}`,
  })
  @IsOptional()
  @IsIn(TIME_SLOT_KEYS)
  proposedTimeSlot?: TimeSlot;
}

/** Body of the routes that say no, with an optional reason. */
export class DeclineDto {
  @ApiPropertyOptional({
    description: 'Why, in a sentence. Read by the other side.',
    example: 'Je ne suis pas disponible ce week-end.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(text)
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export const ADMIN_QUOTE_FILTERS = ['needs_chef'] as const;
