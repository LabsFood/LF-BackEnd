import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const MENU_PERIODS = ['week', 'month'];

export class CreateMenuDto {
  @ApiProperty({ maxLength: 160, example: 'Semaine méditerranéenne' })
  @IsString()
  @Length(1, 160)
  title!: string;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'One or two sentences shown on the public card.',
    example:
      'Une semaine qui voyage : Vietnam, Sénégal, Tunisie, puis retour en Provence.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pitch?: string | null;

  @ApiPropertyOptional({ enum: MENU_PERIODS, default: 'week', example: 'week' })
  @IsOptional()
  @IsIn(MENU_PERIODS)
  period?: 'week' | 'month';

  @ApiPropertyOptional({
    default: false,
    description:
      'Whether the batch cooker does the shopping for this menu. `false` when a menu ' +
      'is created, so nobody advertises a service they did not choose to offer.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  shoppingIncluded?: boolean;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'The dishes, in the order to show them. Only the batch cooker’s own dishes. ' +
      'A dish can sit in several menus.',
    example: ['5b1f3c2e-8a44-4d0e-9f21-3c6a7e9b0d12'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  dishIds?: string[];
}

export class UpdateMenuDto extends PartialType(CreateMenuDto) {}

export class ShowcaseAssignmentDto {
  @ApiProperty({ description: 'A Monday, `YYYY-MM-DD`.', example: '2026-09-28' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'One of the batch cooker’s menus, or `null` for "no menu this week": the ' +
      'public page then shows their published dishes only.',
    example: '3a9d7f10-2c4b-4e8a-9b61-0f5e2d7c8a31',
  })
  // Required, and either a menu id or an explicit null: leaving it out is refused.
  @ValidateIf((assignment: ShowcaseAssignmentDto) => assignment.menuId !== null)
  @IsUUID('4')
  menuId!: string | null;
}

export class PutShowcaseWeeksDto {
  @ApiProperty({ type: [ShowcaseAssignmentDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ShowcaseAssignmentDto)
  assignments!: ShowcaseAssignmentDto[];
}

export class ShowcaseRangeQueryDto {
  @ApiPropertyOptional({
    description: 'First day, `YYYY-MM-DD`; its week is included. Default: this week.',
    example: '2026-09-28',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description:
      'Last day, `YYYY-MM-DD`. Default: eight weeks after `from`; 26 weeks at most.',
    example: '2026-11-16',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  to?: string;
}
