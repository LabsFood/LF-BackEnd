import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import type { BookingStatus, PaymentMethod } from '../../../generated/prisma/client';
import { PhotoConfirmDto } from '../../dishes/dto/photo.dto';
import { BOOKING_STATUSES } from '../domain/booking-status';

export class BookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES, example: 'confirmed' })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Prestations starting at or after this time.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Prestations starting before this time.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class ChefBookingsQueryDto extends BookingsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'One client’s prestations only.' })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class AdminBookingsQueryDto extends ChefBookingsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'One batch cooker page only.' })
  @IsOptional()
  @IsUUID()
  chefId?: string;
}

export class BookingMealDto {
  @ApiProperty({
    format: 'uuid',
    description: 'A published dish of the batch cooker, or of Lab’s Food.',
  })
  @IsUUID()
  mealId!: string;

  @ApiPropertyOptional({
    minimum: 0.5,
    maximum: 50,
    description:
      'Portions of this dish. Without it, the client’s household: adults plus half ' +
      'a portion per child (Recettes BLK-27).',
    example: 2.5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.5)
  @Max(50)
  portions?: number;
}

/**
 * The boxes of the booking flow (CGV art. 5.1), ticked by the client. Their texts and
 * current version come from `GET /me/profile` (`contractTerms`).
 */
export class ContractConsentsDto {
  @ApiProperty({
    description:
      'The CGV version the texts were read in. Another version counts for nothing.',
    example: '1.0',
  })
  @IsString()
  @Length(1, 16)
  version!: string;

  @ApiPropertyOptional({ description: 'The CGV box.', example: true })
  @IsOptional()
  @IsBoolean()
  cgv?: boolean;

  @ApiPropertyOptional({
    description:
      'The débours mandate box, needed when the batch cooker does the shopping.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  deboursMandate?: boolean;

  @ApiPropertyOptional({
    description:
      'The express request to start before the 14-day withdrawal period ends, needed ' +
      'when the prestation falls inside it.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  earlyExecution?: boolean;
}

export class NewBookingDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The service offer booked: its duration and price.',
  })
  @IsUUID()
  serviceOfferId!: string;

  @ApiPropertyOptional({
    description: 'A pricing formule. Its price replaces the offer’s.',
    example: 'essentiel',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  formuleId?: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the prestation starts. The end follows from the offer’s duration.',
    example: '2026-10-21T07:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  persons?: number;

  @ApiPropertyOptional({
    maxLength: 255,
    description:
      'With a postcode, the street is looked up in the official address base ' +
      '(data.geopf.fr); one it cannot place is kept as typed, never refused.',
    example: '12 rue des Lilas, 75011 Paris',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  addressLine?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    description:
      'The city, apart: the agenda shows it without the street. With a postcode ' +
      '(sent, or already booked), it must be a commune that postcode serves in the ' +
      'official base (geo.api.gouv.fr): otherwise 422 `ADDRESS_CITY_MISMATCH`, ' +
      '`communes` listing those it serves; 502/504 `GEO_UNAVAILABLE` when that base ' +
      'fails.',
    example: 'Paris',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  addressCity?: string;

  @ApiPropertyOptional({ maxLength: 16, example: '75011' })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  addressPostalCode?: string;

  @ApiPropertyOptional({ maxLength: 2000, example: 'Digicode 4521B, 3e étage.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'The client does the shopping.', default: false })
  @IsOptional()
  @IsBoolean()
  shoppingByClient?: boolean;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 20,
    default: 0,
    description:
      'Extra dishes beyond what the offer covers (the "Plats supp." counter), each ' +
      'charged `extraMealCents` from `GET /service-offers/{id}/price`.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  extraMeals?: number;

  @ApiPropertyOptional({ type: [BookingMealDto], description: 'The dishes, 20 at most.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((meal: BookingMealDto) => meal.mealId)
  @ValidateNested({ each: true })
  @Type(() => BookingMealDto)
  meals?: BookingMealDto[];

  @ApiPropertyOptional({
    type: ContractConsentsDto,
    description:
      'The client’s boxes, sent with the « Commander avec obligation de paiement » ' +
      'click. Required from 2026-11-21 (`CONTRACT_CONSENT_REQUIRED` lists what is ' +
      'missing). Ignored when a batch cooker or an admin books: only the client can ' +
      'consent, through `POST /me/bookings/{id}/consents`.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContractConsentsDto)
  consents?: ContractConsentsDto;

  @ApiPropertyOptional({
    enum: ['cb', 'avance_immediate', 'cesu'],
    description:
      'CGV V1 5.1 (decision of 2026-11-19): how the client will pay, chosen now, paid ' +
      'after the session. With it, the booking is a **request**: the client saves a ' +
      'card (`POST /me/bookings/{id}/card`, whatever the method), the batch cooker ' +
      'accepts within 48 h, and the price is charged after the session. Without it, ' +
      'the older model: paying confirms the booking. Ignored when a batch cooker or an ' +
      'admin books. `METHOD_NOT_OFFERED`, `CARD_NOT_AVAILABLE`, `URSSAF_LINK_NONE`, ' +
      '`URSSAF_LINK_REFUSED`, `URSSAF_DOSSIER_MISSING` (422); a link under review is fine.',
  })
  @IsOptional()
  @IsIn(['cb', 'avance_immediate', 'cesu'])
  paymentMethod?: PaymentMethod;
}

export class NewBookingForClientDto extends NewBookingDto {
  @ApiProperty({ format: 'uuid', description: 'The client’s account.' })
  @IsUUID()
  clientId!: string;
}

/** What a client may change: the details while `pending`, and two statuses. */
export class UpdateBookingDto extends PartialType(
  OmitType(NewBookingDto, [
    'serviceOfferId',
    'formuleId',
    'consents',
    'paymentMethod',
  ] as const),
) {
  @ApiPropertyOptional({
    enum: ['cancelled', 'completed'],
    description: 'Cancel (nothing paid, not started), or close a delivered prestation.',
  })
  @IsOptional()
  @IsIn(['cancelled', 'completed'])
  status?: 'cancelled' | 'completed';
}

/** A batch cooker moves the prestation along; the details are the client's. */
export class ChefUpdateBookingDto {
  @ApiProperty({
    enum: ['cancelled', 'shopping', 'cooking', 'delivered', 'completed'],
    description:
      '`cooking` is the arrival on site: from 2 h before the start, it records `arrivedAt`.',
  })
  @IsIn(['cancelled', 'shopping', 'cooking', 'delivered', 'completed'])
  status!: 'cancelled' | 'shopping' | 'cooking' | 'delivered' | 'completed';
}

export class AdminUpdateBookingDto extends PartialType(
  OmitType(NewBookingDto, [
    'serviceOfferId',
    'formuleId',
    'consents',
    'paymentMethod',
  ] as const),
) {
  @ApiPropertyOptional({
    enum: BOOKING_STATUSES,
    description:
      'Any status, audited. `disputed` (never from `cancelled`) opens a dispute; ' +
      '`completed` or `cancelled` closes it.',
  })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @ApiPropertyOptional({ minimum: 0, description: 'Cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'What the client pays, cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountTtc?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'After the tax credit, cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountAfterTax?: number;
}

/** Step 3 of a prestation photo: the dish-photo confirm, plus a caption. */
export class BookingPhotoConfirmDto extends PhotoConfirmDto {
  @ApiPropertyOptional({ maxLength: 160, example: 'Les bocaux étiquetés' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  caption?: string;
}

export class RescheduleDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'The new start; the duration stays. More than 48 h away, as the current start ' +
      'must be, and free in the batch cooker’s agenda.',
    example: '2026-10-28T08:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  startsAt!: Date;
}

export class RescheduleAnswerDto {
  @ApiProperty({
    enum: ['accepted', 'declined', 'withdrawn'],
    description:
      'The other side confirms (`accepted`) or declines; whoever proposed it withdraws.',
    example: 'accepted',
  })
  @IsIn(['accepted', 'declined', 'withdrawn'])
  decision!: 'accepted' | 'declined' | 'withdrawn';
}

/** Body of `POST …/bookings/{id}/meals/replace`: a dish in allergy conflict, and the new one. */
export class ReplaceMealDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The dish in conflict with the client’s allergies.',
  })
  @IsUUID()
  from!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'A published dish of the batch cooker or of Lab’s Food, safe for the client.',
  })
  @IsUUID()
  to!: string;
}

/** A batch cooker's answer to a request (CGV 5.2): only a refusal carries a reason. */
export class RefuseBookingDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Shown to the client in the refusal e-mail.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Where the card setup page sends the client back. */
export class BookingCardSetupDto {
  @ApiProperty({ example: 'https://batchcooking.labsfood.fr/reservation/carte?ok=1' })
  @IsString()
  successUrl!: string;

  @ApiProperty({ example: 'https://batchcooking.labsfood.fr/reservation/carte?ok=0' })
  @IsString()
  cancelUrl!: string;
}

export class BookingCardConfirmDto {
  @ApiProperty({ description: 'The `session_id` Stripe put on the return URL.' })
  @IsString()
  @MaxLength(255)
  sessionId!: string;
}
