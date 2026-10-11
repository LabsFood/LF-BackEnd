import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export const CONTACT_SOURCES = ['labsfood', 'batchcooking'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONTACT_STATUSES = ['new', 'read', 'replied', 'archived'] as const;

/** What an admin may set by hand. `replied` only ever comes from sending a reply. */
export const SETTABLE_CONTACT_STATUSES = ['new', 'read', 'archived'] as const;

export const DEFAULT_CONTACT_SUBJECT = 'Demande générale';

/**
 * How many messages one sender may leave per window. Counted twice, because the
 * two do not catch the same abuse: per IP address by the throttler (one machine,
 * many addresses), per email address by the service (one address, many machines).
 */
export const CONTACT_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

/** A name has at least one letter: "12345" or "!!!" is not one. */
const HAS_A_LETTER = /\p{L}/u;

/** 8 to 15 digits, with the separators people type and an optional leading +. */
const PHONE = /^\+?(?:[\s().-]*\d){8,15}[\s().-]*$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Body of `POST /contact-messages`. */
export class SubmitContactMessageDto {
  @ApiProperty({
    enum: CONTACT_SOURCES,
    description: 'The site the form is on.',
    example: 'labsfood',
  })
  @IsIn(CONTACT_SOURCES)
  source!: ContactSource;

  @ApiProperty({ example: 'Sophie Marchand', minLength: 2, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  @Matches(HAS_A_LETTER, { message: 'name must contain at least one letter' })
  name!: string;

  @ApiProperty({
    description: 'Where the team answers. The only way back to the sender.',
    example: 'sophie.marchand@exemple.fr',
  })
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({
    description:
      '8 to 15 digits; spaces, dots, dashes, brackets and a leading + allowed.',
    example: '06 12 34 56 78',
    maxLength: 32,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  @Matches(PHONE, { message: 'phone must be a phone number (8 to 15 digits)' })
  phone?: string;

  @ApiPropertyOptional({
    description:
      'What it is about, as the form words it. Shown as written in the inbox; ' +
      `"${DEFAULT_CONTACT_SUBJECT}" when left out.`,
    example: 'Batch cooking',
    maxLength: 160,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  subject?: string;

  @ApiProperty({ minLength: 10, maxLength: 5000 })
  @Transform(trim)
  @IsString()
  @Length(10, 5000)
  message!: string;

  @ApiPropertyOptional({
    description:
      'Leave empty. A field people never see: a form that fills it is a robot, and ' +
      'its message is accepted without being kept.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;
}

export class ListContactMessagesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CONTACT_STATUSES })
  @IsOptional()
  @IsIn(CONTACT_STATUSES)
  status?: (typeof CONTACT_STATUSES)[number];
}

/** Body of `PATCH /admin/contact-messages/:id`. */
export class UpdateContactMessageDto {
  @ApiProperty({
    enum: SETTABLE_CONTACT_STATUSES,
    description:
      '`read` when the message is opened, `archived` to put it away, `new` to bring ' +
      'it back. `replied` cannot be set: it follows a reply actually sent.',
  })
  @IsIn(SETTABLE_CONTACT_STATUSES)
  status!: (typeof SETTABLE_CONTACT_STATUSES)[number];
}

/** Body of `POST /admin/contact-messages/:id/reply`. */
export class ReplyContactMessageDto {
  @ApiProperty({
    description: 'The answer, emailed to the sender as written.',
    minLength: 2,
    maxLength: 5000,
    example: 'Bonjour Sophie, merci pour votre message. Nous intervenons bien à Nice…',
  })
  @Transform(trim)
  @IsString()
  @Length(2, 5000)
  body!: string;
}
