import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

/** Quote statuses in the order a quote goes through them. */
export const QUOTE_STATUSES = [
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'declined',
];
export const QUOTE_STATUS_HELP =
  '`submitted`: just sent by the client. `in_review`: an admin is working on it. ' +
  '`quoted`: a price was sent. `accepted` / `declined`: the client answered.';

export class CreateQuoteDto {
  @ApiProperty({
    description: 'Short label for the event or request.',
    example: 'Birthday dinner for 12',
  })
  @IsString()
  title!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Number of guests to cater for.',
    example: 12,
  })
  @IsInt()
  @Min(1)
  persons!: number;

  @ApiProperty({
    minimum: 1,
    description: 'Number of courses or meals requested.',
    example: 3,
  })
  @IsInt()
  @Min(1)
  mealsCount!: number;

  @ApiProperty({
    description: 'Desired cuisine style or region.',
    example: 'Mediterranean',
  })
  @IsString()
  cuisine!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Dietary constraints to respect (e.g. vegetarian, nut-free).',
    example: ['vegetarian'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diet?: string[];

  @ApiProperty({
    description: 'Free-text brief describing the event, venue, and expectations.',
    example: 'Garden party, informal service, dessert required.',
  })
  @IsString()
  brief!: string;
}

export class UpdateQuoteAdminDto extends PartialType(CreateQuoteDto) {
  @ApiPropertyOptional({
    enum: QUOTE_STATUSES,
    description:
      `${QUOTE_STATUS_HELP} Set \`quoted\` when sending a price. Only these values ` +
      'are valid; another one fails with a server error today.',
    example: 'quoted',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'The price before the tax credit, in cents.',
    example: 45000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quoteAmountTtc?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'What the client really pays after the 50 % "services à la personne" tax ' +
      'credit, in cents.',
    example: 22500,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quoteAmountAfterTax?: number;

  @ApiPropertyOptional({
    description: 'A note for the client, shown with the price.',
    example: 'Includes service staff and cleanup.',
  })
  @IsOptional()
  @IsString()
  quoteNote?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The batch cooker who will take the request: their account id (`userId` in ' +
      '`GET /admin/chefs`). Only a verified batch cooker can be assigned, else ' +
      '`422 CHEF_NOT_ASSIGNABLE`. Send `null` to unassign.',
    example: 'f5eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
  })
  // Left out: untouched. `null`: unassign. Anything else must be a uuid.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  assignedChefUserId?: string | null;
}
