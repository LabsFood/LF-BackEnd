import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

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
    description: 'Workflow status (e.g. `pending`, `quoted`, `accepted`, `declined`).',
    example: 'quoted',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Quoted price including tax, in minor currency units (cents).',
    example: 45000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quoteAmountTtc?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Quoted net price after tax, in minor currency units (cents).',
    example: 37500,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quoteAmountAfterTax?: number;

  @ApiPropertyOptional({
    description: 'Admin note sent back to the client with the quote.',
    example: 'Includes service staff and cleanup.',
  })
  @IsOptional()
  @IsString()
  quoteNote?: string;
}
