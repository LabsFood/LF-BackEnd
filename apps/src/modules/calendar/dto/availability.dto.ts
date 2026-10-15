import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class WeeklySlotDto {
  @ApiPropertyOptional({
    description: 'As read. Ignored on save: every save issues new ids, read them back.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiProperty({
    minimum: 0,
    maximum: 6,
    description: '0 = Monday … 6 = Sunday.',
    example: 1,
  })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 1439,
    description: 'Start, in minutes since midnight, Paris time (540 = 9:00).',
    example: 540,
  })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute!: number;

  @ApiProperty({
    minimum: 1,
    maximum: 1440,
    description: 'End, excluded, in minutes since midnight (780 = 13:00).',
    example: 780,
  })
  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute!: number;
}

export class AvailabilityExceptionDto {
  @ApiPropertyOptional({
    description: 'As read. Ignored on save: every save issues new ids, read them back.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiProperty({ description: 'The day, `YYYY-MM-DD`.', example: '2026-12-24' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({
    enum: ['closed', 'extra'],
    description: '`closed` takes the day off; `extra` adds a range to it.',
    example: 'closed',
  })
  @IsIn(['closed', 'extra'])
  kind!: 'closed' | 'extra';

  @ApiPropertyOptional({ description: 'For `extra` only.', example: 840 })
  @ValidateIf((o: AvailabilityExceptionDto) => o.kind === 'extra')
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute?: number;

  @ApiPropertyOptional({ description: 'For `extra` only.', example: 1080 })
  @ValidateIf((o: AvailabilityExceptionDto) => o.kind === 'extra')
  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute?: number;

  @ApiPropertyOptional({ maxLength: 255, example: 'Réveillon en famille' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/** `PUT /chef/availability`: the whole schedule, replaced at once. */
export class ScheduleDto {
  @ApiProperty({ type: [WeeklySlotDto], description: 'The weekly template.' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WeeklySlotDto)
  weekly!: WeeklySlotDto[];

  @ApiProperty({
    type: [AvailabilityExceptionDto],
    description: 'Days off and extra ranges, 50 at most.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityExceptionDto)
  exceptions!: AvailabilityExceptionDto[];

  @ApiPropertyOptional({
    description:
      'The `version` read with the schedule. When sent, a save from a stale tab is ' +
      'refused with 409 `SCHEDULE_CHANGED` instead of erasing the other tab’s edits.',
    example: 'k3Vq0Zb1xT2mN8aR',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string;
}

export class WindowQueryDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-19T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Excluded. At most 31 days after `from`.',
    example: '2026-11-02T00:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  to!: Date;
}

export class ChefSlotsQueryDto extends WindowQueryDto {
  @ApiProperty({ minimum: 30, maximum: 1440, description: 'Minutes.', example: 180 })
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(1440)
  durationMinutes!: number;
}

export class PublicSlotsQueryDto extends WindowQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The service offer to book: its duration sets the slots. Without it, the batch ' +
      'cooker’s most expensive active offer, named in the answer.',
  })
  @IsOptional()
  @IsUUID()
  offerId?: string;
}

export class AgendaQueryDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-09-28T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Excluded. At most 42 days after `from`: the month grid, six weeks.',
    example: '2026-11-09T00:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  to!: Date;
}

export class AgendaSummaryQueryDto {
  @ApiProperty({ minimum: 2020, maximum: 2100, example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;
}

export class TimeBlockDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-22T12:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Excluded. After `startsAt`, in the future, 42 days at most.',
    example: '2026-10-22T14:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'For the batch cooker only.',
    example: 'Dentiste',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
